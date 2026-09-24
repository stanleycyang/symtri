import postgres from "postgres";
import { embeddingInputHash, signalEmbeddingText, topicEmbeddingText, EMBEDDING_DIMENSIONS } from "../ai/embed";
import { topicEdges, topics } from "../universe";
import { relationshipKey } from "./activity";
import type { SignalEvent, SignalFeed, SnapshotDay, SourceStatus } from "./model";

let connection: ReturnType<typeof postgres> | undefined;

function embeddingCandidates(events: SignalEvent[]) {
  return events.map((event) => ({ id: event.id, hash: embeddingInputHash(signalEmbeddingText(event)) }));
}

function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for persistent signals");
  const hostname = new URL(url).hostname;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  connection ??= postgres(url, { max: 1, prepare: false, ssl: local ? false : "require", connect_timeout: 5 });
  return connection;
}

export async function persistSignals(feed: SignalFeed): Promise<number> {
  if (!feed.events.length) return 0;
  const sql = database();
  const rows = feed.events.map((event) => ({
    id: event.id, source: event.source, external_id: event.externalId,
    title: event.title, url: event.url, summary: event.summary,
    published_at: event.publishedAt, importance: event.importance, topics: event.topics,
  }));
  await sql`
    insert into signal_events
      (id, source, external_id, title, url, summary, published_at, importance, topics)
    select id, source, external_id, title, url, summary, published_at::timestamptz, importance, topics
    from jsonb_to_recordset(${sql.json(rows)}::jsonb) as incoming
      (id text, source text, external_id text, title text, url text, summary text,
       published_at text, importance double precision, topics jsonb)
    on conflict (id) do update set
      title = excluded.title, url = excluded.url, summary = excluded.summary,
      importance = excluded.importance, topics = excluded.topics
  `;
  return rows.length;
}

export async function persistEmbeddings(feed: SignalFeed, embedder: (inputs: string[]) => Promise<number[][]>): Promise<number> {
  const sql = database();
  const eventInputs = feed.events.map((event) => ({ id: event.id, text: signalEmbeddingText(event) }));
  const topicInputs = topics.map((topic) => ({ id: topic.id, text: topicEmbeddingText(topic) }));
  const [eventRows, topicRows] = await Promise.all([
    eventInputs.length ? sql`select id, embedding_input_hash from signal_events where id in ${sql(eventInputs.map((item) => item.id))}` : Promise.resolve([]),
    sql`select topic_id as id, embedding_input_hash from topic_embeddings`,
  ]);
  const eventHashes = new Map(eventRows.map((row) => [row.id as string, row.embedding_input_hash as string | null]));
  const topicHashes = new Map(topicRows.map((row) => [row.id as string, row.embedding_input_hash as string]));
  const pendingEvents = eventInputs.map((item) => ({ ...item, hash: embeddingInputHash(item.text) }))
    .filter((item) => eventHashes.has(item.id) && eventHashes.get(item.id) !== item.hash);
  const pendingTopics = topicInputs.map((item) => ({ ...item, hash: embeddingInputHash(item.text) }))
    .filter((item) => topicHashes.get(item.id) !== item.hash);
  const pending = [...pendingEvents, ...pendingTopics];
  if (!pending.length) return 0;
  const vectors = await embedder(pending.map((item) => item.text));
  if (vectors.length !== pending.length || vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error("Embedder returned invalid vectors");
  }
  const eventUpdates = pendingEvents.map((item, index) => ({ id: item.id, hash: item.hash, embedding: `[${vectors[index].join(",")}]` }));
  const topicUpdates = pendingTopics.map((item, index) => ({ id: item.id, hash: item.hash, embedding: `[${vectors[pendingEvents.length + index].join(",")}]` }));
  if (eventUpdates.length) await sql`
    update signal_events as target set embedding = incoming.embedding::vector(256), embedding_input_hash = incoming.hash
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
  return pending.length;
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
    select id, source, external_id, title, url, summary, published_at, importance, topics
    from signal_events where published_at >= now() - interval '14 days'
    order by published_at desc limit 300
  `;
  if (!rows.length) return null;
  const events: SignalEvent[] = rows.map((row) => ({
    id: row.id, source: row.source, externalId: row.external_id,
    title: row.title, url: row.url, summary: row.summary,
    publishedAt: new Date(row.published_at).toISOString(),
    importance: row.importance, topics: row.topics,
  }));
  const sources: SourceStatus = { "hacker-news": "unavailable", github: "unavailable", arxiv: "unavailable" };
  return { observedAt: new Date().toISOString(), events, sources, partial: true, scope: "archive" };
}

export async function getArchiveCount(): Promise<number> {
  const rows = await database()`select count(*)::int as count from signal_events`;
  return Number(rows[0].count);
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
    where (select count(*) from jsonb_each_text(coalesce(signal_snapshots.feed->'sources', '{}'::jsonb)) as saved(source_id, status) where saved.status = 'ok')
       <= (select count(*) from jsonb_each_text(coalesce(excluded.feed->'sources', '{}'::jsonb)) as incoming(source_id, status) where incoming.status = 'ok')
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
