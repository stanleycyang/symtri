import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import postgres from "postgres";
import { getArchiveActivity, getArchiveChildCounts, getArchiveRelationships, getPersistedCurrentFeed, getStoredFeed, getTopicPage, persistCurrentFeed, rebuildKnowledgeGraph, getKnowledgeGraph } from "../lib/data/storage";
import { getUniverseCatalog } from "../lib/data/catalog";

const url = process.env.SYMTRI_TEST_DATABASE_URL;
if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("Use an isolated loopback Postgres database");
}
process.env.DATABASE_URL = url;
const sql = postgres(url, { max: 1, prepare: false, ssl: false });
const rows = Number(process.env.SYMTRI_SCALE_ROWS ?? 20_000);
if (!Number.isInteger(rows) || rows < 1_000 || rows > 100_000) throw new Error("SYMTRI_SCALE_ROWS must be 1,000-100,000");
const timings: Record<string, number> = {};
async function measure<T>(name: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await work();
  timings[name] = Math.round(performance.now() - started);
  return result;
}

async function main() {
try {
  for (const file of ["001_signals.sql", "002_embeddings.sql", "003_lock_down_api.sql"]) {
    await sql.unsafe(await readFile(new URL(`../db/${file}`, import.meta.url), "utf8"));
  }
  const migrations = (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((file) => file.endsWith(".sql")).sort();
  for (const file of migrations) await sql.unsafe(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  const topics = sql.json([{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }]);
  const linkedTopics = sql.json([{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }, { topicId: "markets", subtopicId: null, relevance: .8 }]);
  await measure("insertMs", () => sql`
    insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
    select 'scale-' || item.n, case item.n % 4 when 0 then 'github' when 1 then 'hacker-news'
      when 2 then 'arxiv' else 'openalex' end,
      item.n::text, 'Scale topic ' || item.n, 'https://scale.example/' || item.n,
      'Unique source evidence ' || item.n,
      now() - (item.n % 336) * interval '1 hour', 30,
      case when item.n % 5 = 0 then ${linkedTopics}::jsonb else ${topics}::jsonb end
    from generate_series(1, ${rows}) as item(n)`);
  await sql`analyze signal_events`;
  const catalog = await getUniverseCatalog();
  const stored = await measure("feedMs", () => getStoredFeed());
  assert.equal(stored?.events.length, 300);
  const activity = await measure("activityMs", () => getArchiveActivity(new Date(), catalog));
  const childCounts = await measure("childCountsMs", () => getArchiveChildCounts());
  const relationships = await measure("relationshipsMs", () => getArchiveRelationships(new Date(), catalog));
  const page = await measure("topicPageMs", () => getTopicPage("ai", "ai-agents", null));
  await measure("graphRollupMs", () => rebuildKnowledgeGraph(relationships));
  await persistCurrentFeed({ ...stored!, archiveCount: rows, activity, childCounts, relationships, catalog });
  assert.equal(activity.ai.count, rows);
  assert.equal(childCounts["ai-agents"], rows);
  assert.equal(relationships["ai:markets"], Math.floor(rows / 5));
  assert.equal((await getKnowledgeGraph())?.relationships["ai:markets"], Math.floor(rows / 5));
  assert.equal((await getPersistedCurrentFeed())?.archiveCount, rows);
  assert.equal(page.events.length, 20);
  assert.ok(page.nextCursor);
  console.log(JSON.stringify({ rows, ...timings, graphDirtyDays: 0 }));
} finally {
  await sql.end();
}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
