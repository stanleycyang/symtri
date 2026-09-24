import { createHash } from "node:crypto";
import { database } from "./storage";
import { seedCatalog, type Topic, type UniverseCatalog, type Vec3 } from "../universe";
import type { SignalEvent, TopicMatch } from "./model";

type ConceptRow = { id: string; name: string; short: string; parent_id: string | null; position: Vec3; color: string; status: string; merged_into: string | null };

export async function seedUniverseCatalog(): Promise<void> {
  const sql = database();
  for (const topic of seedCatalog.topics) {
    await sql`insert into concept_catalog (id, name, short, position, color, status, seeded)
      values (${topic.id}, ${topic.name}, ${topic.short}, ${sql.json(topic.position)}::jsonb, ${topic.color}, 'public', true)
      on conflict (id) do nothing`;
    for (const child of topic.children) await sql`
      insert into concept_catalog (id, name, short, parent_id, position, color, status, seeded)
      values (${child.id}, ${child.name}, ${child.name}, ${topic.id}, ${sql.json(child.position)}::jsonb, ${topic.color}, 'public', true)
      on conflict (id) do nothing`;
  }
  const rows = await sql`select id from catalog_revisions limit 1`;
  if (!rows.length) await recordCatalogRevision();
}

export function catalogFromRows(rows: ConceptRow[], revision: number, sourceLabels: Record<string, string>): UniverseCatalog {
  const roots = rows.filter((row) => !row.parent_id && row.status === "public");
  const children = new Map<string, ConceptRow[]>();
  for (const row of rows) if (row.parent_id && row.status === "public") {
    const siblings = children.get(row.parent_id) ?? [];
    siblings.push(row);
    children.set(row.parent_id, siblings);
  }
  const topics: Topic[] = roots.map((row) => ({
    id: row.id, name: row.name, short: row.short,
    description: `Explore recent observations about ${row.name.toLowerCase()}.`,
    position: row.position, color: row.color, activity: 30, change: 0, signals: 0,
    children: (children.get(row.id) ?? [])
      .map((child) => ({ id: child.id, name: child.name, position: child.position, activity: 30, signals: 0 })),
  }));
  const known = new Set(topics.map((topic) => topic.id));
  return { revision, topics, sourceLabels, topicEdges: seedCatalog.topicEdges.filter(([a, b]) => known.has(a) && known.has(b)),
    redirects: Object.fromEntries(rows.filter((row) => row.merged_into).map((row) => [row.id, row.merged_into!])) };
}

export async function recordCatalogRevision(): Promise<number> {
  const sql = database();
  const rows = await sql<ConceptRow[]>`select id, name, short, parent_id, position, color, status, merged_into from concept_catalog order by id`;
  const sources = await sql<{ id: string; name: string }[]>`select id, name from source_catalog where status = 'active' order by id`;
  const catalog = catalogFromRows(rows, 0, Object.fromEntries(sources.map((row) => [row.id, row.name])));
  const saved = await sql<{ id: number }[]>`insert into catalog_revisions (catalog) values (${sql.json(catalog)}::jsonb) returning id`;
  await sql`delete from current_feed where id = 'current'`;
  return Number(saved[0].id);
}

export async function getUniverseCatalog(at?: Date): Promise<UniverseCatalog> {
  if (!process.env.DATABASE_URL) return seedCatalog;
  const sql = database();
  const rows = at
    ? await sql<{ id: number; catalog: UniverseCatalog }[]>`select id, catalog from catalog_revisions where created_at <= ${at} order by id desc limit 1`
    : await sql<{ id: number; catalog: UniverseCatalog }[]>`select id, catalog from catalog_revisions order by id desc limit 1`;
  if (!rows.length) return seedCatalog;
  return { ...rows[0].catalog, revision: Number(rows[0].id) };
}

export function placement(id: string, parent: Topic | null, occupied: Vec3[]): Vec3 {
  const digest = createHash("sha256").update(id).digest();
  const base = digest.readUInt32BE(0) / 0xffffffff * Math.PI * 2;
  for (let step = 0; step < 40; step++) {
    const angle = base + step * 2.399963;
    const radius = parent ? 5.5 + Math.floor(step / 9) * 2 : 19 + Math.floor(step / 12) * 8;
    const center = parent?.position ?? [0, 0, 0];
    const candidate: Vec3 = [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius * .75,
      center[2] + (digest.readUInt16BE(4) / 65535 - .5) * (parent ? 5 : 14),
    ];
    if (occupied.every((point) => Math.hypot(point[0] - candidate[0], point[1] - candidate[1], point[2] - candidate[2]) >= (parent ? 3.5 : 8))) return candidate;
  }
  return [0, 0, 30 + occupied.length * 4];
}

const phraseStop = new Set(["about", "after", "again", "against", "among", "based", "before", "build", "building", "could", "first", "from", "have", "into", "latest", "more", "new", "next", "open", "research", "shows", "study", "their", "these", "those", "through", "under", "using", "with", "without", "world", "your"]);
export function candidatePhrases(title: string): string[] {
  const words = title.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [];
  const phrases = new Set<string>();
  for (let index = 0; index < words.length - 1; index++) {
    if (phraseStop.has(words[index]) || phraseStop.has(words[index + 1])) continue;
    phrases.add(`${words[index]} ${words[index + 1]}`);
  }
  return [...phrases].slice(0, 12);
}

export function catalogMatches(event: SignalEvent, catalog: UniverseCatalog): TopicMatch[] {
  const input = event.classificationInput ?? { title: event.title, summary: event.summary, categories: [] };
  const text = `${input.title} ${input.summary}`.toLowerCase();
  const publicRoots = new Set(catalog.topics.map((topic) => topic.id));
  const publicChildren = new Set(catalog.topics.flatMap((topic) => topic.children.map((child) => child.id)));
  const matches = new Map(event.topics.filter((match) => publicRoots.has(match.topicId)).map((match) => [match.topicId,
    { ...match, subtopicId: match.subtopicId && publicChildren.has(match.subtopicId) ? match.subtopicId : null }]));
  for (const topic of catalog.topics) {
    const organicRoot = topic.id.startsWith("organic-");
    const root = [topic.name.toLowerCase(), topic.id.replaceAll("-", " ")];
    const rootMatch = organicRoot && root.some((alias) => alias.length >= 4 && text.includes(alias) &&
      new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i").test(text));
    const child = topic.children.find((item) => item.id.startsWith("organic-") && item.name.length >= 5 && text.includes(item.name.toLowerCase()));
    if (!rootMatch && !child) continue;
    const existing = matches.get(topic.id);
    matches.set(topic.id, { topicId: topic.id, subtopicId: child?.id ?? existing?.subtopicId ?? null, relevance: Math.max(existing?.relevance ?? 0, child ? .83 : .67) });
  }
  return [...matches.values()].sort((a, b) => b.relevance - a.relevance).slice(0, 3);
}

export function candidateParent(events: SignalEvent[]): string | null {
  const counts = new Map<string, number>();
  for (const event of events) for (const match of event.topics) counts.set(match.topicId, (counts.get(match.topicId) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= Math.ceil(events.length * .7) ? best[0] : null;
}

export async function getGrowthStatus() {
  const sql = database();
  const concepts = await sql`select
    count(*) filter (where status = 'public')::int as public_points,
    count(*) filter (where status = 'public' and not seeded)::int as organic_points,
    count(*) filter (where status = 'inactive')::int as inactive_points
    from concept_catalog`;
  const candidates = await sql`select count(*)::int as count from concept_candidates where status = 'candidate'`;
  const revision = await sql`select id from catalog_revisions order by id desc limit 1`;
  const stale = await sql`select count(*)::int as count from signal_events where catalog_revision < ${Number(revision[0]?.id ?? 0)}`;
  const graph = await sql`select count(*)::int as count from knowledge_graph_dirty_days`;
  const sources = await sql`select status, count(*)::int as count from source_catalog group by status`;
  return { ...concepts[0], candidates: Number(candidates[0].count),
    catalogBacklog: Number(stale[0].count), graphDirtyDays: Number(graph[0].count),
    sources: Object.fromEntries(sources.map((row) => [row.status, Number(row.count)])) };
}
