import { createHash } from "node:crypto";
import { candidateParent, candidatePhrases, catalogMatches, getUniverseCatalog, placement, recordCatalogRevision } from "./catalog";
import { database } from "./storage";
import type { SignalEvent } from "./model";
import { embeddingModelId } from "../ai/embed";

type DiscoveryRow = Pick<SignalEvent, "id" | "source" | "title" | "summary" | "url" | "topics"> & { published_at: Date };
const key = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);

export async function syncArchiveConcepts(limit = 1000): Promise<number> {
  const catalog = await getUniverseCatalog();
  if (!catalog.revision) return 0;
  const sql = database();
  const rows = await sql<(DiscoveryRow & { external_id: string; importance: number; classifier_version: number; classification_input: SignalEvent["classificationInput"] })[]>`
    select id, source, external_id, title, summary, url, published_at, importance, topics, classifier_version, classification_input
    from signal_events where catalog_revision < ${catalog.revision}
    order by first_seen_at desc, id limit ${limit}`;
  if (!rows.length) return 0;
  const updates = rows.map((row) => {
    const event: SignalEvent = {
      id: row.id, source: row.source, externalId: row.external_id, title: row.title, summary: row.summary,
      url: row.url, publishedAt: new Date(row.published_at).toISOString(), importance: row.importance,
      topics: row.topics, classificationInput: row.classification_input,
    };
    return { id: row.id, topics: catalogMatches(event, catalog) };
  });
  await sql`update signal_events as target set topics = incoming.topics, catalog_revision = ${catalog.revision}
    from jsonb_to_recordset(${sql.json(updates)}::jsonb) as incoming(id text, topics jsonb)
    where target.id = incoming.id`;
  const relations = updates.flatMap((update) => update.topics.flatMap((match) => [
    { signal_id: update.id, concept_id: match.topicId, relevance: match.relevance },
    ...(match.subtopicId ? [{ signal_id: update.id, concept_id: match.subtopicId, relevance: match.relevance }] : []),
  ]));
  if (relations.length) await sql`
    insert into signal_concepts (signal_id, concept_id, relevance)
    select signal_id, concept_id, relevance
    from jsonb_to_recordset(${sql.json(relations)}::jsonb) as incoming(signal_id text, concept_id text, relevance double precision)
    on conflict (signal_id, concept_id) do update set relevance = excluded.relevance, assigned_at = now()`;
  await sql`delete from signal_concepts as relation where relation.signal_id in ${sql(updates.map((row) => row.id))}
    and not exists (select 1 from jsonb_to_recordset(${sql.json(relations)}::jsonb)
      as current(signal_id text, concept_id text, relevance double precision)
      where current.signal_id = relation.signal_id and current.concept_id = relation.concept_id)`;
  return updates.length;
}

function publisher(row: DiscoveryRow): string {
  if (row.source !== "hacker-news") return row.source;
  try { return new URL(row.url).hostname.replace(/^www\./, ""); } catch { return row.source; }
}

export async function discoverConcepts(now = new Date()): Promise<{ candidates: number; promoted: number }> {
  const sql = database();
  const catalog = await getUniverseCatalog();
  const rows = await sql<DiscoveryRow[]>`
    select event.id, event.source, event.title, event.summary, event.url, event.topics, event.published_at
    from signal_events as event join source_catalog as source on source.id = event.source and source.status = 'active'
    where event.published_at >= ${now}::timestamptz - interval '30 days'
    order by event.published_at desc limit 2000`;
  const known = new Set(catalog.topics.flatMap((topic) => [topic.name.toLowerCase(), ...topic.children.map((child) => child.name.toLowerCase())]));
  const groups = new Map<string, DiscoveryRow[]>();
  for (const row of rows) for (const phrase of candidatePhrases(row.title)) {
    if (known.has(phrase)) continue;
    const members = groups.get(phrase) ?? [];
    members.push(row);
    groups.set(phrase, members);
  }
  const eligible = [...groups].filter(([, members]) => members.length >= 5)
    .sort((a, b) => b[1].length - a[1].length).slice(0, 40);
  let promoted = 0;
  let changed = false;
  const existingPositions = catalog.topics.flatMap((topic) => [topic.position, ...topic.children.map((child) => child.position)]);
  let childSlots = 2 - Number((await sql`select count(*)::int as count from concept_catalog where not seeded and parent_id is not null and promoted_at::date = ${now.toISOString().slice(0, 10)}::date`)[0].count);
  let rootSlots = 1 - Number((await sql`select count(*)::int as count from concept_catalog where not seeded and parent_id is null and promoted_at >= ${now}::timestamptz - interval '7 days'`)[0].count);
  for (const [phrase, members] of eligible) {
    const unique = [...new Map(members.map((row) => [row.id, row])).values()];
    const parentId = candidateParent(unique.map((row) => ({ topics: row.topics } as SignalEvent)));
    const parent = catalog.topics.find((topic) => topic.id === parentId) ?? null;
    const publishers = new Set(unique.map(publisher));
    const days = new Set(unique.map((row) => new Date(row.published_at).toISOString().slice(0, 10)));
    const candidateId = key(phrase);
    await sql`insert into concept_candidates (id, name, parent_id, evidence_count, publisher_count, active_days, last_seen_at)
      values (${candidateId}, ${phrase}, ${parent?.id ?? null}, ${unique.length}, ${publishers.size}, ${days.size}, ${now})
      on conflict (id) do update set evidence_count = excluded.evidence_count,
        publisher_count = excluded.publisher_count, active_days = excluded.active_days, last_seen_at = excluded.last_seen_at`;
    const evidence = unique.map((row) => ({ candidate_id: candidateId, signal_id: row.id, publisher: publisher(row), observed_day: new Date(row.published_at).toISOString().slice(0, 10) }));
    await sql`insert into concept_candidate_evidence (candidate_id, signal_id, publisher, observed_day)
      select candidate_id, signal_id, publisher, observed_day::date from
      jsonb_to_recordset(${sql.json(evidence)}::jsonb) as incoming(candidate_id text, signal_id text, publisher text, observed_day text)
      on conflict do nothing`;
    const required = parent ? { signals: 5, publishers: 2, days: 2 } : { signals: 12, publishers: 3, days: 4 };
    if (unique.length < required.signals || publishers.size < required.publishers || days.size < required.days) continue;
    if (!parent && !unique.some((row) => row.source === "arxiv" || row.source === "openalex")) continue;
    const vectors = await sql<{ embedded: number; coherence: number | null }[]>`
      with evidence as (
        select id, embedding from signal_events where id in ${sql(unique.map((row) => row.id))}
          and embedding is not null and embedding_model = ${embeddingModelId()} limit 24
      )
      select (select count(*)::int from evidence) as embedded,
        (select avg(1 - (first.embedding <=> second.embedding))::double precision
          from evidence as first join evidence as second on first.id < second.id) as coherence`;
    if (Number(vectors[0].embedded) < required.signals || Number(vectors[0].coherence) < .65) continue;
    if (parent ? childSlots <= 0 : rootSlots <= 0) continue;
    const current = await sql<{ status: string }[]>`select status from concept_candidates where id = ${candidateId}`;
    if (current[0]?.status !== "candidate") continue;
    const id = `organic-${candidateId}`;
    const name = phrase.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    const position = placement(id, parent, existingPositions);
    existingPositions.push(position);
    const color = parent?.color ?? "#a7b6bc";
    await sql`insert into concept_catalog (id, name, short, parent_id, aliases, position, color, status)
      values (${id}, ${name}, ${name.length <= 15 ? name.toUpperCase() : name.slice(0, 15).toUpperCase()},
        ${parent?.id ?? null}, ${sql.array([phrase])}, ${sql.json(position)}::jsonb, ${color}, 'public')
      on conflict (id) do nothing`;
    await sql`update concept_candidates set status = 'promoted', promoted_id = ${id} where id = ${candidateId}`;
    promoted++;
    changed = true;
    if (parent) childSlots--; else rootSlots--;
  }
  if (changed) await recordCatalogRevision();
  return { candidates: eligible.length, promoted };
}

export async function retireInactiveConcepts(now = new Date()): Promise<number> {
  const sql = database();
  const retired = await sql<{ id: string }[]>`
    update concept_catalog as concept set status = 'inactive', inactive_at = ${now}
    where concept.status = 'public' and concept.promoted_at < ${now}::timestamptz - interval '90 days'
      and not exists (
        select 1 from signal_concepts as assignment join signal_events as event on event.id = assignment.signal_id
        where assignment.concept_id = concept.id and event.published_at >= ${now}::timestamptz - interval '90 days'
      ) returning id`;
  if (retired.length) await recordCatalogRevision();
  return retired.length;
}

export async function mergeConcepts(from: string, into: string): Promise<void> {
  if (from === into) throw new Error("A point cannot merge into itself");
  const sql = database();
  const target = await sql`select id from concept_catalog where id = ${into} and status = 'public'`;
  if (!target.length) throw new Error("Merge target is not public");
  const source = await sql`update concept_catalog set status = 'merged', merged_into = ${into}, inactive_at = now()
    where id = ${from} and status = 'public' returning id`;
  if (!source.length) throw new Error("Merge source is not public");
  await recordCatalogRevision();
}

export async function reactivateConcept(id: string): Promise<void> {
  const changed = await database()`update concept_catalog set status = 'public', merged_into = null, inactive_at = null
    where id = ${id} and status <> 'public' returning id`;
  if (!changed.length) throw new Error("Point is already public or unknown");
  await recordCatalogRevision();
}

export async function deactivateConcept(id: string): Promise<void> {
  const changed = await database()`update concept_catalog set status = 'inactive', inactive_at = now()
    where id = ${id} and status = 'public' returning id`;
  if (!changed.length) throw new Error("Point is already inactive or unknown");
  await recordCatalogRevision();
}
