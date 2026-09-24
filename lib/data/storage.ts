import postgres from "postgres";
import { embeddingInputHash, signalEmbeddingText, topicEmbeddingText, EMBEDDING_DIMENSIONS } from "../ai/embed";
import { embeddingModelId } from "../ai/embed";
import { topicEdges, topics } from "../universe";
import { relationshipKey } from "./activity";
import { CLASSIFIER_VERSION, classifySignal } from "./classify";
import { selectDistinctHeadlines } from "./select";
import type { RelatedSignal, SignalEvent, SignalFeed, SnapshotDay, SourceStatus } from "./model";

let connection: ReturnType<typeof postgres> | undefined;

function embeddingCandidates(events: SignalEvent[]) {
  return events.map((event) => ({ id: event.id, hash: embeddingInputHash(signalEmbeddingText(event)) }));
}

function currentTopics(row: { topics?: unknown; classifier_version?: unknown; classification_input?: unknown }): SignalEvent["topics"] {
  const stored = row.topics as SignalEvent["topics"];
  if (typeof row.classifier_version !== "number" || row.classifier_version >= CLASSIFIER_VERSION || !row.classification_input) return stored;
  const input = row.classification_input as { title?: unknown; summary?: unknown; categories?: unknown };
  if (typeof input.title !== "string" || typeof input.summary !== "string") return stored;
  const categories = Array.isArray(input.categories) ? input.categories.filter((value): value is string => typeof value === "string") : [];
  return classifySignal(input.title, input.summary, categories);
}

function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for persistent signals");
  const hostname = new URL(url).hostname;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  connection ??= postgres(url, {
    max: 1, prepare: false, ssl: local ? false : "require",
    connect_timeout: 5, idle_timeout: 10, max_lifetime: 60,
  });
  return connection;
}

export async function persistSignals(feed: SignalFeed): Promise<number> {
  if (!feed.events.length) return 0;
  const sql = database();
  const rows = feed.events.map((event) => ({
    id: event.id, source: event.source, external_id: event.externalId,
    title: event.title, url: event.url, summary: event.summary,
    published_at: event.publishedAt, importance: event.importance, topics: event.topics,
    classification_input: event.classificationInput ?? { title: event.title, summary: event.summary, categories: [] },
  }));
  await sql`
    update signal_events as target set
      title = incoming.title, summary = incoming.summary,
      importance = incoming.importance, topics = incoming.topics,
      classification_input = incoming.classification_input,
      classifier_version = ${CLASSIFIER_VERSION},
      embedding = case when target.title is distinct from incoming.title or target.summary is distinct from incoming.summary then null else target.embedding end,
      embedding_input_hash = case when target.title is distinct from incoming.title or target.summary is distinct from incoming.summary then null else target.embedding_input_hash end,
      embedding_model = case when target.title is distinct from incoming.title or target.summary is distinct from incoming.summary then null else target.embedding_model end
    from jsonb_to_recordset(${sql.json(rows)}::jsonb) as incoming
      (id text, title text, summary text, importance double precision, topics jsonb, classification_input jsonb)
    where target.id = incoming.id
      and not exists (
        select 1 from signal_events as other
        where other.id <> target.id and other.content_key =
          md5(lower(regexp_replace(btrim(incoming.title) || E'\n' || btrim(incoming.summary), '[[:space:]]+', ' ', 'g')))
      )
  `;
  const inserted = await sql`
    insert into signal_events
      (id, source, external_id, title, url, summary, published_at, importance, topics, classification_input, classifier_version)
    select id, source, external_id, title, url, summary, published_at::timestamptz, importance, topics, classification_input, ${CLASSIFIER_VERSION}
    from jsonb_to_recordset(${sql.json(rows)}::jsonb) as incoming
      (id text, source text, external_id text, title text, url text, summary text,
       published_at text, importance double precision, topics jsonb, classification_input jsonb)
    on conflict do nothing returning id
  `;
  await sql`
    insert into signal_observations (source, external_id, signal_id, observed_url)
    select incoming.source, incoming.external_id, stored.id, incoming.url
    from jsonb_to_recordset(${sql.json(rows)}::jsonb) as incoming
      (source text, external_id text, url text, title text, summary text)
    cross join lateral (select
      lower(regexp_replace(regexp_replace(split_part(split_part(incoming.url, '?', 1), '#', 1), '^https?://', ''), '/+$', '')) as canonical_url,
      md5(lower(regexp_replace(btrim(incoming.title) || E'\n' || btrim(incoming.summary), '[[:space:]]+', ' ', 'g'))) as content_key
    ) as identity
    join lateral (
      select id from signal_events as candidate
      where candidate.canonical_url = identity.canonical_url or candidate.content_key = identity.content_key
      order by (candidate.canonical_url = identity.canonical_url) desc, candidate.first_seen_at
      limit 1
    ) as stored on true
    on conflict (source, external_id) do update set
      signal_id = excluded.signal_id, observed_url = excluded.observed_url, last_seen_at = now()
  `;
  return inserted.length;
}

export async function refreshStoredClassifications(limit = 500): Promise<number> {
  const sql = database();
  const rows = await sql`
    select id, classification_input
    from signal_events
    where classifier_version < ${CLASSIFIER_VERSION} and classification_input is not null
    order by published_at desc limit ${limit}
  `;
  if (!rows.length) return 0;
  const updates = rows.map((row) => {
    const input = row.classification_input as { title: string; summary: string; categories: string[] };
    return { id: row.id as string, topics: classifySignal(input.title, input.summary, input.categories) };
  });
  await sql`
    update signal_events as target set topics = incoming.topics, classifier_version = ${CLASSIFIER_VERSION}
    from jsonb_to_recordset(${sql.json(updates)}::jsonb) as incoming(id text, topics jsonb)
    where target.id = incoming.id and target.classifier_version < ${CLASSIFIER_VERSION}
  `;
  return updates.length;
}

export async function persistEmbeddings(feed: SignalFeed, embedder: (inputs: string[]) => Promise<number[][]>): Promise<number> {
  const sql = database();
  const eventInputs = feed.events.map((event) => ({ id: event.id, text: signalEmbeddingText(event) }));
  const topicInputs = topics.map((topic) => ({ id: topic.id, text: topicEmbeddingText(topic) }));
  const eventRows = eventInputs.length ? await sql`select id, embedding_input_hash from signal_events where id in ${sql(eventInputs.map((item) => item.id))}` : [];
  const topicRows = await sql`select topic_id as id, embedding_input_hash from topic_embeddings`;
  const eventHashes = new Map(eventRows.map((row) => [row.id as string, row.embedding_input_hash as string | null]));
  const topicHashes = new Map(topicRows.map((row) => [row.id as string, row.embedding_input_hash as string]));
  const pendingEvents = eventInputs.map((item) => ({ ...item, hash: embeddingInputHash(item.text) }))
    .filter((item) => eventHashes.has(item.id) && eventHashes.get(item.id) !== item.hash);
  const pendingTopics = topicInputs.map((item) => ({ ...item, hash: embeddingInputHash(item.text) }))
    .filter((item) => topicHashes.get(item.id) !== item.hash);
  const pending = [...pendingEvents, ...pendingTopics];
  if (!pending.length) return 0;
  let embedded = 0;
  for (let offset = 0; offset < pending.length; offset += 64) {
    const batch = pending.slice(offset, offset + 64);
    const vectors = await embedder(batch.map((item) => item.text));
    if (vectors.length !== batch.length || vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value)))) {
      throw new Error("Embedder returned invalid vectors");
    }
    const eventUpdates = batch.flatMap((item, index) => offset + index < pendingEvents.length
      ? [{ id: item.id, hash: item.hash, embedding: `[${vectors[index].join(",")}]` }] : []);
    const topicUpdates = batch.flatMap((item, index) => offset + index >= pendingEvents.length
      ? [{ id: item.id, hash: item.hash, embedding: `[${vectors[index].join(",")}]` }] : []);
    if (eventUpdates.length) await sql`
      update signal_events as target set embedding = incoming.embedding::vector(256), embedding_input_hash = incoming.hash, embedding_model = ${embeddingModelId()}
      from jsonb_to_recordset(${sql.json(eventUpdates)}::jsonb) as incoming(id text, hash text, embedding text)
      where target.id = incoming.id
    `;
    if (topicUpdates.length) await sql`
      insert into topic_embeddings (topic_id, embedding, embedding_input_hash)
      select id, embedding::vector(256), hash
      from jsonb_to_recordset(${sql.json(topicUpdates)}::jsonb) as incoming(id text, hash text, embedding text)
      on conflict (topic_id) do update set embedding = excluded.embedding,
        embedding_input_hash = excluded.embedding_input_hash, updated_at = now()
    `;
    embedded += batch.length;
  }
  return embedded;
}

export async function getSemanticRelationships(): Promise<Record<string, number>> {
  const rows = await database()`
    select a.topic_id as first_id, b.topic_id as second_id,
      a.embedding_input_hash as first_hash, b.embedding_input_hash as second_hash,
      1 - (a.embedding <=> b.embedding) as similarity
    from topic_embeddings a join topic_embeddings b on a.topic_id < b.topic_id
  `;
  const currentHashes = new Map(topics.map((topic) => [topic.id, embeddingInputHash(topicEmbeddingText(topic))]));
  const knownEdges = new Set(topicEdges.map(([first, second]) => relationshipKey(first, second)));
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = relationshipKey(row.first_id, row.second_id);
    const similarity = Number(row.similarity);
    if (knownEdges.has(key) && row.first_hash === currentHashes.get(row.first_id) && row.second_hash === currentHashes.get(row.second_id) && Number.isFinite(similarity)) {
      result[key] = Math.max(-1, Math.min(1, similarity));
    }
  }
  return result;
}

export async function findSemanticSignals(vector: number[], events: SignalEvent[]): Promise<{ id: string; similarity: number }[]> {
  if (!events.length) return [];
  if (vector.length !== EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) throw new Error("Invalid query embedding");
  const sql = database();
  const candidates = embeddingCandidates(events);
  const literal = `[${vector.join(",")}]`;
  const rows = await sql`
    select stored.id, 1 - (stored.embedding <=> ${literal}::vector(256)) as similarity
    from signal_events as stored
    join jsonb_to_recordset(${sql.json(candidates)}::jsonb) as candidate(id text, hash text)
      on stored.id = candidate.id and stored.embedding_input_hash = candidate.hash
    where stored.embedding is not null
    order by stored.embedding <=> ${literal}::vector(256)
  `;
  return rows.map((row) => ({ id: row.id as string, similarity: Number(row.similarity) }))
    .filter((row) => Number.isFinite(row.similarity));
}

export async function hasCurrentSignalEmbeddings(events: SignalEvent[]): Promise<boolean> {
  if (!events.length) return false;
  const sql = database();
  const candidates = embeddingCandidates(events);
  const rows = await sql`
    select exists(
      select 1 from signal_events as stored
      join jsonb_to_recordset(${sql.json(candidates)}::jsonb) as candidate(id text, hash text)
        on stored.id = candidate.id and stored.embedding_input_hash = candidate.hash
      where stored.embedding is not null
    ) as available
  `;
  return rows[0].available === true;
}

export async function getStoredFeed(): Promise<SignalFeed | null> {
  const sql = database();
  const rows = await sql`
    select id, source, external_id, title, url, summary, published_at, importance, topics, classification_input, classifier_version
    from signal_events where published_at >= now() - interval '14 days' and jsonb_array_length(topics) > 0
    order by published_at desc limit 300
  `;
  if (!rows.length) return null;
  const events: SignalEvent[] = rows.map((row) => ({
    id: row.id, source: row.source, externalId: row.external_id,
    title: row.title, url: row.url, summary: row.summary,
    publishedAt: new Date(row.published_at).toISOString(),
    importance: row.importance, topics: currentTopics(row),
  })).filter((event) => event.topics.length > 0);
  if (!events.length) return null;
  const sources: SourceStatus = { "hacker-news": "unavailable", github: "unavailable", arxiv: "unavailable" };
  return { observedAt: new Date().toISOString(), events, sources, partial: true, scope: "archive" };
}

export async function getRecentTopicEvents(references: { id: string; childId: string | null }[]): Promise<SignalEvent[]> {
  const sql = database();
  const found = new Map<string, SignalEvent>();
  for (const reference of references.slice(0, 2)) {
    const filters = reference.childId
      ? [{ topicId: reference.id, subtopicId: reference.childId }, { topicId: reference.id }]
      : [{ topicId: reference.id }];
    for (const filter of filters) {
      const rows = await sql`
        select id, source, external_id, title, url, summary, published_at, importance, topics, classification_input, classifier_version
        from signal_events
        where published_at >= now() - interval '14 days'
          and topics @> ${sql.json([filter])}::jsonb
        order by published_at desc limit 40
      `;
      for (const row of rows) {
        const current = currentTopics(row);
        if (!current.some((match) => match.topicId === filter.topicId && (!filter.subtopicId || match.subtopicId === filter.subtopicId))) continue;
        found.set(row.id, {
          id: row.id, source: row.source, externalId: row.external_id,
          title: row.title, url: row.url, summary: row.summary,
          publishedAt: new Date(row.published_at).toISOString(),
          importance: row.importance, topics: current,
        });
      }
    }
  }
  return [...found.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function getArchiveCount(): Promise<number> {
  const rows = await database()`select count(*)::int as count from signal_events`;
  return Number(rows[0].count);
}

export async function countNewSignalsForRun(runId: string): Promise<number> {
  const rows = await database()`
    select count(*)::int as count from signal_events as event
    join ingestion_runs as run on run.id = ${runId}
    where event.first_seen_at >= run.started_at
  `;
  return Number(rows[0].count);
}

export async function rebuildKnowledgeGraph(): Promise<void> {
  await database()`
    with matches as (
      select distinct event.id, match.value->>'topicId' as topic_id
      from signal_events as event
      cross join lateral jsonb_array_elements(event.topics) as match(value)
      where match.value ? 'topicId'
    ), region_totals as (
      select topic_id, count(*)::int as signals from matches group by topic_id
    ), link_totals as (
      select first.topic_id || ':' || second.topic_id as link, count(*)::int as signals
      from matches as first join matches as second
        on first.id = second.id and first.topic_id < second.topic_id
      group by first.topic_id, second.topic_id
    )
    insert into knowledge_graph (id, updated_at, region_counts, relationships)
    select 'current', now(),
      coalesce((select jsonb_object_agg(topic_id, signals) from region_totals), '{}'::jsonb),
      coalesce((select jsonb_object_agg(link, signals) from link_totals), '{}'::jsonb)
    on conflict (id) do update set updated_at = excluded.updated_at,
      region_counts = excluded.region_counts, relationships = excluded.relationships
  `;
}

export async function getKnowledgeGraph(): Promise<SignalFeed["knowledgeGraph"] | null> {
  const rows = await database()`select updated_at, region_counts, relationships from knowledge_graph where id = 'current'`;
  if (!rows.length) return null;
  return { updatedAt: new Date(rows[0].updated_at).toISOString(), regionCounts: rows[0].region_counts, relationships: rows[0].relationships };
}

export async function getPendingEmbeddingEvents(limit = 200): Promise<SignalEvent[]> {
  const rows = await database()`
    select id, source, external_id, title, url, summary, published_at, importance, topics
    from signal_events
    where embedding is null or embedding_model is distinct from ${embeddingModelId()}
    order by first_seen_at, id limit ${limit}
  `;
  return rows.map((row) => ({
    id: row.id, source: row.source, externalId: row.external_id,
    title: row.title, url: row.url, summary: row.summary,
    publishedAt: new Date(row.published_at).toISOString(), importance: row.importance, topics: row.topics,
  }));
}

export async function acquireIngestionLease(runId: string): Promise<boolean> {
  const rows = await database()`
    insert into ingestion_lease (name, run_id, expires_at)
    values ('main', ${runId}, now() + interval '45 minutes')
    on conflict (name) do update set run_id = excluded.run_id, expires_at = excluded.expires_at
    where ingestion_lease.expires_at < now() or ingestion_lease.run_id = excluded.run_id
    returning name
  `;
  return rows.length === 1;
}

export async function releaseIngestionLease(runId: string): Promise<void> {
  await database()`delete from ingestion_lease where name = 'main' and run_id = ${runId}`;
}

export async function startIngestionRun(runId: string): Promise<boolean> {
  const rows = await database()`insert into ingestion_runs (id, status) values (${runId}, 'running')
    on conflict (id) do update set status = 'running' where ingestion_runs.status in ('queued', 'running')
    returning id`;
  return rows.length === 1;
}

export async function claimIngestionSlot(slot: string): Promise<boolean> {
  const rows = await database()`insert into ingestion_runs (id, status) values (${slot}, 'queued')
    on conflict do nothing returning id`;
  return rows.length === 1;
}

export async function releaseQueuedIngestionSlot(slot: string): Promise<void> {
  await database()`delete from ingestion_runs where id = ${slot} and status = 'queued'`;
}

export type IngestionResult = {
  status: "complete" | "partial" | "failed";
  sources?: SourceStatus;
  fetched?: number;
  mapped?: number;
  added?: number;
  embedded?: number;
  embeddingStatus?: string;
  error?: string;
};

export async function finishIngestionRun(runId: string, result: IngestionResult): Promise<void> {
  await database()`
    update ingestion_runs set completed_at = now(), status = ${result.status},
      source_status = ${database().json(result.sources ?? {})}::jsonb,
      fetched_count = ${result.fetched ?? 0}, mapped_count = ${result.mapped ?? 0},
      new_count = ${result.added ?? 0}, embedded_count = ${result.embedded ?? 0},
      embedding_status = ${result.embeddingStatus ?? "unavailable"}, error = ${result.error ?? null}
    where id = ${runId}
  `;
}

export async function getIngestionStatus() {
  const sql = database();
  const runs = await sql`select started_at, completed_at, status, source_status, fetched_count, mapped_count,
    new_count, embedded_count, embedding_status from ingestion_runs order by started_at desc limit 1`;
  const counts = await sql`select count(*)::int as signals,
    count(*) filter (where embedding is not null and embedding_model = ${embeddingModelId()})::int as vectors,
    count(*) filter (where embedding is null or embedding_model is distinct from ${embeddingModelId()})::int as embedding_backlog,
    count(*) filter (where classifier_version < ${CLASSIFIER_VERSION} and classification_input is not null)::int as classification_backlog
    from signal_events`;
  const last = runs[0];
  return {
    signals: Number(counts[0].signals), vectors: Number(counts[0].vectors),
    embeddingBacklog: Number(counts[0].embedding_backlog), classificationBacklog: Number(counts[0].classification_backlog),
    lastRun: last ? {
      startedAt: new Date(last.started_at).toISOString(),
      completedAt: last.completed_at ? new Date(last.completed_at).toISOString() : null,
      status: last.status, sources: last.source_status,
      fetched: last.fetched_count, mapped: last.mapped_count,
      added: last.new_count, embedded: last.embedded_count,
      embeddingStatus: last.embedding_status,
    } : null,
  };
}

export async function getLatestIngestionFeedMetadata(): Promise<Pick<SignalFeed, "observedAt" | "sources" | "partial"> | null> {
  const rows = await database()<{
    completed_at: Date;
    source_status: SourceStatus;
  }[]>`
    select completed_at, source_status
    from ingestion_runs
    where completed_at is not null and status in ('complete', 'partial')
    order by completed_at desc limit 1
  `;
  const latest = rows[0];
  if (!latest) return null;
  return {
    observedAt: new Date(latest.completed_at).toISOString(),
    sources: latest.source_status,
    partial: latest.source_status["hacker-news"] !== "ok" || latest.source_status.github !== "ok" || latest.source_status.arxiv !== "ok",
  };
}

export async function searchKnowledge(query: string, vector: number[] | null): Promise<{ event: SignalEvent; similarity: number | null }[]> {
  if (vector && (vector.length !== EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value)))) throw new Error("Invalid query embedding");
  const sql = database();
  const literal = vector ? `[${vector.join(",")}]` : null;
  const lexical = await sql`
      with request as (select websearch_to_tsquery('english', ${query}) as terms),
      ranked as (
        select id, source, external_id, title, url, summary, published_at, importance, topics,
          ts_rank_cd(to_tsvector('english', title || ' ' || summary), request.terms) as rank
        from signal_events cross join request
        where to_tsvector('english', title || ' ' || summary) @@ request.terms
        order by rank desc, published_at desc limit 30
      ), recent as (
        select id, source, external_id, title, url, summary, published_at, importance, topics,
          ts_rank_cd(to_tsvector('english', title || ' ' || summary), request.terms) as rank
        from signal_events cross join request
        where to_tsvector('english', title || ' ' || summary) @@ request.terms
        order by published_at desc limit 30
      )
      select distinct on (id) * from (select * from ranked union all select * from recent) as candidates
      order by id, rank desc
    `;
  const semantic = literal ? await sql`
      select id, source, external_id, title, url, summary, published_at, importance, topics,
        1 - (embedding <=> ${literal}::vector(256)) as similarity
      from signal_events
      where embedding is not null and embedding_model = ${embeddingModelId()}
      order by embedding <=> ${literal}::vector(256) limit 30
    ` : [];
  const scores = new Map<string, { row: (typeof lexical)[number]; score: number; similarity: number | null }>();
  for (const row of lexical) scores.set(row.id, { row, score: .6 + Math.min(.3, Number(row.rank)), similarity: null });
  for (const row of semantic) {
    const similarity = Number(row.similarity);
    if (!Number.isFinite(similarity) || similarity < .25) continue;
    const previous = scores.get(row.id);
    scores.set(row.id, { row, score: (previous?.score ?? 0) + similarity, similarity });
  }
  const now = Date.now();
  const freshness = (publishedAt: Date) => .35 * 2 ** (-Math.max(0, now - publishedAt.getTime()) / (72 * 3_600_000));
  return [...scores.values()].sort((a, b) =>
    b.score + freshness(b.row.published_at) - a.score - freshness(a.row.published_at)
    || b.row.published_at.getTime() - a.row.published_at.getTime())
    .slice(0, 6).map(({ row, similarity }) => ({
      similarity,
      event: { id: row.id, source: row.source, externalId: row.external_id, title: row.title,
        url: row.url, summary: row.summary, publishedAt: new Date(row.published_at).toISOString(),
        importance: row.importance, topics: row.topics },
    }));
}

export async function getRelatedSignals(id: string): Promise<RelatedSignal[]> {
  const sql = database();
  const origin = await sql`
    select embedding::text as vector, topics, title
    from signal_events
    where id = ${id} and embedding is not null and embedding_model = ${embeddingModelId()}
    limit 1
  `;
  if (!origin.length) return [];
  const candidates = await sql<{ id: string; source: SignalEvent["source"]; title: string; url: string; summary: string;
    published_at: Date; topics: SignalEvent["topics"]; similarity: number }[]>`
    select id, source, title, url, summary, published_at, topics,
      1 - (embedding <=> ${origin[0].vector}::vector(256)) as similarity
    from signal_events
    where id <> ${id} and embedding is not null and embedding_model = ${embeddingModelId()}
      and jsonb_array_length(topics) > 0
    order by embedding <=> ${origin[0].vector}::vector(256)
    limit 24
  `;
  const originRegions = new Set((origin[0].topics as SignalEvent["topics"]).map((match) => match.topicId));
  return selectDistinctHeadlines(candidates.filter((row) => {
    const similarity = Number(row.similarity);
    const sharedRegion = (row.topics as SignalEvent["topics"]).some((match) => originRegions.has(match.topicId));
    return Number.isFinite(similarity) && similarity >= (sharedRegion ? .55 : .68);
  }), 3, [origin[0].title]).map((row) => ({
    id: row.id, source: row.source, title: row.title, url: row.url, summary: row.summary,
    publishedAt: new Date(row.published_at).toISOString(), topics: row.topics,
  }));
}

export async function persistSnapshot(feed: SignalFeed): Promise<void> {
  if (!feed.events.length) return;
  const sql = database();
  const capturedAt = new Date(feed.observedAt).toISOString();
  const day = capturedAt.slice(0, 10);
  await sql`
    insert into signal_snapshots (day, captured_at, feed)
    values (${day}::date, ${capturedAt}::timestamptz, ${sql.json(feed)}::jsonb)
    on conflict (day) do update set captured_at = excluded.captured_at, feed = excluded.feed
    where not exists (
        select 1 from jsonb_each_text(coalesce(signal_snapshots.feed->'sources', '{}'::jsonb)) as saved(source_id, status)
        where (case saved.status when 'ok' then 2 when 'partial' then 1 else 0 end)
          > (case excluded.feed->'sources'->>saved.source_id when 'ok' then 2 when 'partial' then 1 else 0 end)
      )
      and jsonb_array_length(coalesce(signal_snapshots.feed->'events', '[]'::jsonb))
       <= jsonb_array_length(coalesce(excluded.feed->'events', '[]'::jsonb))
  `;
}

export async function getSnapshotDays(): Promise<SnapshotDay[]> {
  const rows = await database()`
    select day::text as day, captured_at,
      jsonb_array_length(feed->'events')::int as event_count
    from signal_snapshots order by day desc limit 14
  `;
  return rows.map((row) => ({ day: row.day, capturedAt: new Date(row.captured_at).toISOString(), eventCount: row.event_count }));
}

export async function getSnapshotFeed(day: string): Promise<SignalFeed | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const rows = await database()`select captured_at, feed from signal_snapshots where day = ${day}::date limit 1`;
  if (!rows.length) return null;
  const feed = rows[0].feed as SignalFeed;
  return { ...feed, observedAt: new Date(rows[0].captured_at).toISOString(), scope: "history" };
}
