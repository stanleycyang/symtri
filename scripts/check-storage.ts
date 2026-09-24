import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { acquireIngestionLease, backfillSnapshotActivity, claimIngestionSlot, countNewSignalsForRun, findSemanticSignals, finishIngestionRun, getArchiveActivity, getArchiveRelationships, getIngestionStatus, getKnowledgeGraph, getLatestIngestionFeedMetadata, getPendingEmbeddingEvents, getRecentTopicEvents, getRelatedSignals, getSemanticRelationships, getSnapshotDays, getSnapshotFeed, getStoredFeed, hasCurrentSignalEmbeddings, persistEmbeddings, persistSignals, persistSnapshot, rebuildKnowledgeGraph, refreshStoredClassifications, releaseIngestionLease, releaseQueuedIngestionSlot, searchKnowledge, startIngestionRun } from "../lib/data/storage";
import { EMBEDDING_DIMENSIONS, embeddingModelId } from "../lib/ai/embed";
import type { SignalEvent, SignalFeed } from "../lib/data/model";
import { rollingFeed } from "../lib/data/rolling";
import { regionActivity } from "../lib/data/activity";
import { CLASSIFIER_VERSION } from "../lib/data/classify";
import { GET as getPublicSignals } from "../app/api/signals/route";
import { GET as getHistory } from "../app/api/history/route";
import { POST as askSymtri } from "../app/api/ask/route";

const testUrl = process.env.SYMTRI_TEST_DATABASE_URL;
if (!testUrl || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(testUrl).hostname)) {
  throw new Error("Set SYMTRI_TEST_DATABASE_URL to an isolated local Postgres database");
}
process.env.DATABASE_URL = testUrl;

const sql = postgres(testUrl, { max: 1, prepare: false, ssl: false });
const externalId = `storage-check-${randomUUID()}`;
const id = `github:${externalId}`;
const unclassifiedId = `github:${externalId}-unclassified`;
const relatedId = `github:${externalId}-related`;
const weakParentId = `github:${externalId}-weak-parent`;
const sharedThreadId = `github:${externalId}-shared-thread`;
const foreignId = `github:${externalId}-foreign`;
const quantumId = `arxiv:${externalId}-quantum`;
const cosmicId = `arxiv:${externalId}-cosmic`;
const archiveId = `github:${externalId}-archive`;
const crowdPrefix = `github:${externalId}-crowd-`;
const knowledgePrefix = `github:${externalId}-knowledge-`;
const runId = randomUUID();
const competingRunId = randomUUID();

async function main() {
  const migration = await readFile(new URL("../db/001_signals.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const vectorMigration = await readFile(new URL("../db/002_embeddings.sql", import.meta.url), "utf8");
  await sql.unsafe(vectorMigration);
  const accessMigration = await readFile(new URL("../db/003_lock_down_api.sql", import.meta.url), "utf8");
  await sql.unsafe(accessMigration);
  const ingestionMigration = await readFile(new URL("../supabase/migrations/20260924000000_ingestion.sql", import.meta.url), "utf8");
  await sql.unsafe(ingestionMigration);
  const graphMigration = await readFile(new URL("../supabase/migrations/20260924001000_knowledge_graph.sql", import.meta.url), "utf8");
  await sql.unsafe(graphMigration);
  const canonicalMigration = await readFile(new URL("../supabase/migrations/20260924002000_canonical_ingestion.sql", import.meta.url), "utf8");
  await sql.unsafe(canonicalMigration);
  const observationsMigration = await readFile(new URL("../supabase/migrations/20260924003000_source_observations.sql", import.meta.url), "utf8");
  await sql.unsafe(observationsMigration);
  const backfillMigration = await readFile(new URL("../supabase/migrations/20260924004000_backfill_observations.sql", import.meta.url), "utf8");
  await sql.unsafe(backfillMigration);
  const lookupMigration = await readFile(new URL("../supabase/migrations/20260924005000_topic_lookup.sql", import.meta.url), "utf8");
  await sql.unsafe(lookupMigration);
  const foreignAgentsMigration = await readFile(new URL("../supabase/migrations/20260924006000_foreign_agents.sql", import.meta.url), "utf8");
  await sql.unsafe(foreignAgentsMigration);
  const classificationMigration = await readFile(new URL("../supabase/migrations/20260924007000_classification_refresh.sql", import.meta.url), "utf8");
  await sql.unsafe(classificationMigration);
  const legacyFirst = `github:${externalId}-legacy-first`;
  const legacySecond = `hacker-news:${externalId}-legacy-second`;
  await sql`
    insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
    values
      (${legacyFirst}, 'github', ${`${externalId}-legacy-first`}, 'Mirrored paper', ${`https://first.example/${externalId}`}, 'Same content', now(), 50, '[]'::jsonb),
      (${legacySecond}, 'hacker-news', ${`${externalId}-legacy-second`}, 'Mirrored paper', ${`https://second.example/${externalId}`}, 'Same content', now(), 20, '[]'::jsonb)
  `;
  await sql`
    insert into signal_observations (source, external_id, signal_id, observed_url)
    values
      ('github', ${`${externalId}-legacy-first`}, ${legacyFirst}, ${`https://first.example/${externalId}`}),
      ('hacker-news', ${`${externalId}-legacy-second`}, ${legacySecond}, ${`https://second.example/${externalId}`})
  `;
  const uniqueContentMigration = await readFile(new URL("../supabase/migrations/20260924008000_unique_content.sql", import.meta.url), "utf8");
  await sql.unsafe(uniqueContentMigration);
  const knowledgeSearchMigration = await readFile(new URL("../supabase/migrations/20260924009000_knowledge_search_index.sql", import.meta.url), "utf8");
  await sql.unsafe(knowledgeSearchMigration);
  const queryIdentityMigration = await readFile(new URL("../supabase/migrations/20260924010000_query_identity.sql", import.meta.url), "utf8");
  await sql.unsafe(queryIdentityMigration);
  const archiveActivityMigration = await readFile(new URL("../supabase/migrations/20260924011000_archive_activity.sql", import.meta.url), "utf8");
  await sql.unsafe(archiveActivityMigration);
  const recentRelationshipsMigration = await readFile(new URL("../supabase/migrations/20260924012000_recent_relationships.sql", import.meta.url), "utf8");
  await sql.unsafe(recentRelationshipsMigration);
  assert.equal((await sql`select public.symtri_canonical_url('https://news.ycombinator.com/item?id=47&utm_source=hn') as url`)[0].url, "news.ycombinator.com/item?id=47");
  assert.equal((await sql`select public.symtri_canonical_url('https://example.com/article?b=2&utm_source=hn&a=1&fbclid=abc') as url`)[0].url, "example.com/article?a=1&b=2");
  assert.equal((await sql`select count(*)::int as count from signal_events where id in (${legacyFirst}, ${legacySecond})`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from signal_observations where signal_id = ${legacyFirst}`)[0].count, 2);
  await sql`delete from signal_events where id = ${legacyFirst}`;
  assert.equal((await sql`select count(*)::int as count from pg_indexes where indexname = 'signal_events_topics_gin_idx'`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from pg_indexes where indexname = 'signal_events_content_key_key'`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from pg_indexes where indexname = 'signal_events_search_idx'`)[0].count, 1);
  const protectedTables = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select relname, relrowsecurity from pg_class
    where relname in ('signal_events', 'signal_snapshots', 'topic_embeddings', 'ingestion_lease', 'ingestion_runs', 'knowledge_graph', 'signal_observations')
  `;
  assert.equal(protectedTables.length, 7);
  assert.ok(protectedTables.every((table) => table.relrowsecurity));
  const event: SignalEvent = {
    id, source: "github", externalId, title: "First title",
    url: `https://github.com/symtri/${externalId}`, summary: "Storage roundtrip",
    publishedAt: new Date(Date.now() + 3_600_000).toISOString(), importance: 50,
    topics: [{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }],
  };
  const feed: SignalFeed = {
    observedAt: new Date().toISOString(), events: [event],
    sources: { "hacker-news": "unavailable", github: "ok", arxiv: "unavailable" },
    partial: true, scope: "sample",
  };
  try {
    const repository: SignalEvent = { ...event, id: `github:${externalId}-shared-page`, externalId: `${externalId}-shared-page`,
      url: `https://github.com/symtri/${externalId}/shared-page`, title: "Agent toolkit repository", summary: "A repository for agent tools", importance: 80 };
    const discussion: SignalEvent = { ...repository, id: `hacker-news:${externalId}-shared-page`, source: "hacker-news",
      externalId: `${externalId}-shared-page`, url: `${repository.url}?utm_source=hn`, title: "Agent toolkit discussion",
      summary: "A discussion about agent tools", importance: 30 };
    const sharedFeed = { ...feed, events: [discussion, repository, { ...discussion, importance: 1 }] };
    assert.equal(await persistSignals(sharedFeed), 1);
    assert.equal((await sql`select id from signal_events where canonical_url = ${`github.com/symtri/${externalId}/shared-page`}`)[0].id, repository.id);
    assert.deepEqual((await sql`select signal_id from signal_observations where external_id = ${repository.externalId} order by source`).map((row) => row.signal_id), [repository.id, repository.id]);
    assert.equal(await persistSignals(sharedFeed), 0);
    await sql`delete from signal_events where id = ${repository.id}`;
    const selfPostOne: SignalEvent = { ...event, id: `hacker-news:${externalId}-self-1`, source: "hacker-news",
      externalId: `${externalId}-self-1`, title: "First distinct question", summary: "AI agent question one",
      url: `https://news.ycombinator.com/item?id=${externalId}-1` };
    const selfPostTwo: SignalEvent = { ...selfPostOne, id: `hacker-news:${externalId}-self-2`,
      externalId: `${externalId}-self-2`, title: "Second distinct question", summary: "AI agent question two",
      url: `https://news.ycombinator.com/item?id=${externalId}-2` };
    assert.equal(await persistSignals({ ...feed, events: [selfPostOne, selfPostTwo] }), 2);
    assert.equal((await sql`select count(*)::int as count from signal_events where id in (${selfPostOne.id}, ${selfPostTwo.id})`)[0].count, 2);
    assert.deepEqual((await sql`select signal_id from signal_observations where external_id in (${selfPostOne.externalId}, ${selfPostTwo.externalId}) order by external_id`).map((row) => row.signal_id), [selfPostOne.id, selfPostTwo.id]);
    assert.equal(await persistSignals({ ...feed, events: [selfPostOne, selfPostTwo] }), 0);
    await sql`delete from signal_events where id in (${selfPostOne.id}, ${selfPostTwo.id})`;
    assert.equal(await persistSignals(feed), 1);
    assert.ok((await getPendingEmbeddingEvents()).some((item) => item.id === id));
    event.title = "Updated title";
    assert.equal(await persistSignals(feed), 0);
    const duplicate: SignalEvent = { ...event, id: `hacker-news:${externalId}`, source: "hacker-news", externalId, url: `${event.url}/?utm_source=hn`, title: "Duplicate item" };
    assert.equal(await persistSignals({ ...feed, events: [duplicate] }), 0);
    assert.equal((await sql`select count(*)::int as count from signal_events where canonical_url = ${`github.com/symtri/${externalId}`}`)[0].count, 1);
    assert.equal((await sql`select count(*)::int as count from signal_observations where signal_id = ${id}`)[0].count, 2);
    const sameContent: SignalEvent = { ...event, id: `hacker-news:${externalId}-mirror`, source: "hacker-news",
      externalId: `${externalId}-mirror`, url: `https://mirror.example/${externalId}` };
    assert.equal(await persistSignals({ ...feed, events: [sameContent] }), 0);
    assert.equal((await sql`select count(*)::int as count from signal_events where content_key =
      (select content_key from signal_events where id = ${id})`)[0].count, 1);
    assert.equal((await sql`select count(*)::int as count from signal_observations where signal_id = ${id}`)[0].count, 3);
    const stored = await getStoredFeed();
    const result = stored?.events.find((item) => item.id === id);
    assert.equal(result?.title, "Updated title");
    assert.deepEqual(result?.topics, event.topics);
    const unclassified: SignalEvent = { ...event, id: unclassifiedId, externalId: `${externalId}-unclassified`, title: "Urban gardening", summary: "Growing city vegetables", url: `${event.url}/gardening`, topics: [] };
    await persistSignals({ ...feed, events: [unclassified] });
    assert.ok(!(await getStoredFeed())?.events.some((item) => item.id === unclassifiedId));
    assert.equal((await searchKnowledge("Urban gardening", null))[0]?.event.id, unclassifiedId);
    const foreign: SignalEvent = { ...event, id: foreignId, externalId: `${externalId}-foreign`,
      title: "AI critics called foreign agents", url: `${event.url}/foreign`,
      topics: [{ topicId: "ai", subtopicId: "ai-agents", relevance: .9 }] };
    await persistSignals({ ...feed, events: [foreign] });
    await sql.unsafe(foreignAgentsMigration);
    assert.equal((await sql`select topics from signal_events where id = ${foreignId}`)[0].topics[0].subtopicId, null);
    await sql`delete from signal_events where id = ${foreignId}`;
    const quantum: SignalEvent = { ...event, id: quantumId, source: "arxiv", externalId: `${externalId}-quantum`,
      title: "Simulation of a Battery Cell on Quantum Computers", url: `https://arxiv.org/abs/${externalId}-quantum`,
      summary: "Quantum research", topics: [{ topicId: "energy", subtopicId: "energy-battery-storage", relevance: .95 }],
      classificationInput: { title: "Simulation of a Battery Cell on Quantum Computers", summary: "Quantum research", categories: ["quant-ph"] } };
    await persistSignals({ ...feed, events: [quantum] });
    await sql`update signal_events set classifier_version = 0 where id = ${quantumId}`;
    assert.equal((await getStoredFeed())?.events.find((item) => item.id === quantumId)?.topics[0].topicId, "science");
    assert.equal(await refreshStoredClassifications(), 1);
    const reclassified = (await sql`select topics, classification_input, classifier_version from signal_events where id = ${quantumId}`)[0];
    assert.equal(reclassified.topics[0].topicId, "science");
    assert.equal(reclassified.topics[0].subtopicId, "science-physics");
    assert.deepEqual(reclassified.classification_input.categories, ["quant-ph"]);
    assert.equal(reclassified.classifier_version, CLASSIFIER_VERSION);
    assert.equal(await refreshStoredClassifications(), 0);
    await sql`delete from signal_events where id = ${quantumId}`;
    const cosmic: SignalEvent = { ...event, id: cosmicId, source: "arxiv", externalId: `${externalId}-cosmic`,
      title: "Holographic dark energy in cosmology", url: `https://arxiv.org/abs/${externalId}-cosmic`,
      summary: "A study of spacetime and gravity", topics: [{ topicId: "energy", subtopicId: null, relevance: .5 }],
      classificationInput: { title: "Holographic dark energy in cosmology", summary: "A study of spacetime and gravity", categories: ["astro-ph.CO"] } };
    await persistSignals({ ...feed, events: [cosmic] });
    await sql`update signal_events set classifier_version = 0 where id = ${cosmicId}`;
    assert.ok(!(await getStoredFeed())?.events.find((item) => item.id === cosmicId)?.topics.some((match) => match.topicId === "energy"));
    assert.ok(!(await getRecentTopicEvents([{ id: "energy", childId: null }])).some((item) => item.id === cosmicId));
    await sql`delete from signal_events where id = ${cosmicId}`;
    await rebuildKnowledgeGraph();
    assert.equal((await getKnowledgeGraph())?.regionCounts.ai, 1);
    assert.equal(await hasCurrentSignalEmbeddings(feed.events), false);
    const fakeEmbedder = async (inputs: string[]) => inputs.map((_, index) => [index + 1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)]);
    assert.ok(await persistEmbeddings(feed, fakeEmbedder) >= 1);
    assert.ok(!(await getPendingEmbeddingEvents()).some((item) => item.id === id));
    assert.equal(await persistEmbeddings(feed, fakeEmbedder), 0);
    const related: SignalEvent = { ...event, id: relatedId, externalId: `${externalId}-related`, title: "AI powered materials research", summary: "Research agents explore new materials", url: `${event.url}/related`, topics: [{ topicId: "science", subtopicId: "science-materials", relevance: 1 }] };
    await persistSignals({ ...feed, events: [related] });
    await persistEmbeddings({ ...feed, events: [related] }, fakeEmbedder);
    const recent = await getRecentTopicEvents([
      { id: "ai", childId: "ai-agents" }, { id: "science", childId: "science-materials" },
    ]);
    assert.ok(recent.some((item) => item.id === id));
    assert.ok(recent.some((item) => item.id === relatedId));
    await sql`update signal_events set published_at = now() - interval '20 days' where id = ${relatedId}`;
    assert.ok(!(await getRecentTopicEvents([{ id: "science", childId: "science-materials" }])).some((item) => item.id === relatedId));
    assert.equal((await getRelatedSignals(id))[0]?.id, relatedId);
    assert.ok(!(await getRelatedSignals(id)).some((item) => item.id === id));
    assert.deepEqual(await getRelatedSignals(unclassifiedId), []);
    await sql`delete from signal_events where id = ${relatedId}`;
    const moderateVector = `[${[.6, .8, ...Array(EMBEDDING_DIMENSIONS - 2).fill(0)].join(",")}]`;
    await sql`
      insert into signal_events
        (id, source, external_id, title, url, summary, published_at, importance, topics, embedding, embedding_model)
      values
        (${weakParentId}, 'github', ${`${externalId}-weak-parent`}, 'Broad AI policy', ${`${event.url}/weak-parent`},
          'A separate story', now(), 20, ${sql.json([{ topicId: "ai", subtopicId: null, relevance: 1 }])}::jsonb,
          ${moderateVector}::vector(256), ${embeddingModelId()}),
        (${sharedThreadId}, 'github', ${`${externalId}-shared-thread`}, 'Agents coordinate browser workflows', ${`${event.url}/shared-thread`},
          'Related agent research', now(), 20, ${sql.json([{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }])}::jsonb,
          ${moderateVector}::vector(256), ${embeddingModelId()})
    `;
    const threadLinks = await getRelatedSignals(id);
    assert.ok(threadLinks.some((item) => item.id === sharedThreadId));
    assert.ok(!threadLinks.some((item) => item.id === weakParentId));
    await sql`delete from signal_events where id in (${weakParentId}, ${sharedThreadId})`;
    const crowd = Array.from({ length: 300 }, (_, index) => ({
      id: `${crowdPrefix}${index}`, source: "github", external_id: `${externalId}-crowd-${index}`,
      title: `Software sample ${index}`, url: `https://github.com/symtri/${externalId}-crowd-${index}`,
      summary: "A newer unrelated signal", published_at: new Date(Date.now() + 7_200_000 + index).toISOString(),
      importance: 10, topics: [{ topicId: "software", subtopicId: null, relevance: 1 }],
    }));
    await sql`
      insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
      select id, source, external_id, title, url, summary, published_at::timestamptz, importance, topics
      from jsonb_to_recordset(${sql.json(crowd)}::jsonb) as incoming
        (id text, source text, external_id text, title text, url text, summary text,
         published_at text, importance double precision, topics jsonb)
    `;
    assert.ok(!(await getStoredFeed())?.events.some((item) => item.id === id));
    assert.ok((await getRecentTopicEvents([{ id: "ai", childId: "ai-agents" }])).some((item) => item.id === id));
    const batteryRows = Array.from({ length: 41 }, (_, index) => ({
      id: `${crowdPrefix}battery-${index}`, external_id: `${externalId}-battery-${index}`,
      title: `Battery cell simulation ${index}`, url: `https://github.com/symtri/${externalId}-battery-${index}`,
      summary: "Battery cell simulation methods", published_at: new Date(Date.now() + 10_800_000 + index).toISOString(),
    }));
    batteryRows.push({
      id: `${crowdPrefix}battery-recycling`, external_id: `${externalId}-battery-recycling`,
      title: "Battery recycling recovers cathode materials", url: `https://github.com/symtri/${externalId}-battery-recycling`,
      summary: "A process for recycling spent battery cells", published_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
    await sql`
      insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
      select id, 'github', external_id, title, url, summary, published_at::timestamptz, 30,
        ${sql.json([{ topicId: "energy", subtopicId: "energy-battery-storage", relevance: 1 }])}::jsonb
      from jsonb_to_recordset(${sql.json(batteryRows)}::jsonb) as incoming
        (id text, external_id text, title text, url text, summary text, published_at text)
    `;
    assert.ok(!(await getStoredFeed())?.events.some((item) => item.id === `${crowdPrefix}battery-recycling`));
    assert.ok(!(await getRecentTopicEvents([{ id: "energy", childId: "energy-battery-storage" }])).some((item) => item.id === `${crowdPrefix}battery-recycling`));
    const sharedTopics = sql.json([{ topicId: "ai", subtopicId: null, relevance: 1 }, { topicId: "markets", subtopicId: null, relevance: 1 }]);
    for (const [suffix, ageDays] of [["recent-1", 2], ["recent-2", 3], ["expired", 20]] as const) {
      await sql`
        insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
        values (${`${crowdPrefix}link-${suffix}`}, 'github', ${`${externalId}-link-${suffix}`},
          ${`AI markets connection ${suffix}`}, ${`https://github.com/symtri/${externalId}-link-${suffix}`},
          ${`Shared topic observation ${suffix}`}, now() - ${ageDays} * interval '1 day', 30, ${sharedTopics}::jsonb)
      `;
    }
    assert.ok(!(await getStoredFeed())?.events.some((item) => item.id === `${crowdPrefix}link-recent-1`));
    const recentRelationships = await getArchiveRelationships();
    assert.equal(recentRelationships["ai:markets"], 2);
    await rebuildKnowledgeGraph(recentRelationships);
    assert.equal((await getKnowledgeGraph())?.relationships["ai:markets"], 3);
    assert.equal((await getKnowledgeGraph())?.recentRelationships?.["ai:markets"], 2);
    assert.equal((await (await getPublicSignals()).json() as SignalFeed).relationships?.["ai:markets"], 2);
    const gatewayKeyForArchive = process.env.AI_GATEWAY_API_KEY;
    const vercelFlagForArchive = process.env.VERCEL;
    process.env.AI_GATEWAY_API_KEY = "";
    process.env.VERCEL = "";
    try {
      const response = await askSymtri(new Request("http://localhost/api/ask", {
        method: "POST", body: JSON.stringify({ question: "What is new in battery recycling?" }),
      }));
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.deepEqual(result.events.map((item: SignalEvent) => item.id), [`${crowdPrefix}battery-recycling`]);
    } finally {
      if (gatewayKeyForArchive === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = gatewayKeyForArchive;
      if (vercelFlagForArchive === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = vercelFlagForArchive;
    }
    const olderAiId = `${crowdPrefix}older-ai`;
    await sql`
      insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
      values (${olderAiId}, 'github', ${`${externalId}-older-ai`}, 'Older AI agent research',
        ${`https://github.com/symtri/${externalId}-older-ai`}, 'A previous-day agent observation',
        now() - interval '30 hours', 50, ${sql.json([{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }])}::jsonb)
    `;
    const activityAt = new Date();
    const archiveActivity = await getArchiveActivity(activityAt);
    assert.ok(archiveActivity.ai.count >= 2);
    assert.ok(archiveActivity.ai.previous > 0);
    assert.ok(archiveActivity.ai.count > (await getStoredFeed())!.events.filter((item) => item.topics.some((match) => match.topicId === "ai")).length);
    const activityRows = await sql`select id, published_at, importance, topics from signal_events`;
    const expectedActivity = regionActivity(activityRows.map((row) => ({
      id: row.id, publishedAt: new Date(row.published_at).toISOString(), importance: row.importance,
      topics: row.topics,
    })) as SignalEvent[], activityAt.getTime());
    for (const topicId of ["ai", "software"]) {
      assert.equal(archiveActivity[topicId].count, expectedActivity[topicId].count);
      assert.ok(Math.abs(archiveActivity[topicId].score - expectedActivity[topicId].score) < 1e-8);
      assert.equal(archiveActivity[topicId].momentum, expectedActivity[topicId].momentum);
    }
    await sql`delete from signal_events where id like ${`${crowdPrefix}%`}`;
    const semanticRelationships = await getSemanticRelationships();
    assert.ok(Number.isFinite(semanticRelationships["ai:energy"]));
    const aiHash = (await sql`select embedding_input_hash from topic_embeddings where topic_id = 'ai'`)[0].embedding_input_hash;
    try {
      await sql`update topic_embeddings set embedding_input_hash = 'stale-test-hash' where topic_id = 'ai'`;
      assert.ok(!Object.keys(await getSemanticRelationships()).some((key) => key.startsWith("ai:") || key.endsWith(":ai")));
    } finally {
      await sql`update topic_embeddings set embedding_input_hash = ${aiHash} where topic_id = 'ai'`;
    }
    const embedded = await sql`select embedding_input_hash, vector_dims(embedding) as dimensions from signal_events where id = ${id}`;
    assert.equal(embedded[0].dimensions, EMBEDDING_DIMENSIONS);
    assert.equal(await hasCurrentSignalEmbeddings(feed.events), true);
    event.summary = "Storage roundtrip changed";
    await persistSignals(feed);
    assert.equal(await hasCurrentSignalEmbeddings(feed.events), false);
    const queryVector = [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)];
    assert.deepEqual(await findSemanticSignals(queryVector, feed.events), []);
    assert.equal(await persistEmbeddings(feed, fakeEmbedder), 1);
    assert.equal(await hasCurrentSignalEmbeddings(feed.events), true);
    assert.equal((await findSemanticSignals(queryVector, feed.events))[0]?.id, id);
    assert.equal((await searchKnowledge("Storage roundtrip", null))[0]?.event.id, id);
    assert.equal((await searchKnowledge("AI agent work", queryVector))[0]?.event.id, id);
    assert.equal((await searchKnowledge("Urban gardening", queryVector))[0]?.event.id, unclassifiedId);
    const weakVector = [.3, Math.sqrt(1 - .3 ** 2), ...Array(EMBEDDING_DIMENSIONS - 2).fill(0)];
    assert.deepEqual(await searchKnowledge("Ancient pyramids", weakVector), []);
    const refreshed = await sql`select embedding_input_hash from signal_events where id = ${id}`;
    assert.notEqual(refreshed[0].embedding_input_hash, embedded[0].embedding_input_hash);
    assert.equal(await acquireIngestionLease(runId), true);
    assert.equal(await acquireIngestionLease(runId), true);
    assert.equal(await acquireIngestionLease(competingRunId), false);
    const slot = `hour:${randomUUID()}`;
    assert.equal(await claimIngestionSlot(slot), true);
    assert.equal(await claimIngestionSlot(slot), false);
    await releaseQueuedIngestionSlot(slot);
    assert.equal(await claimIngestionSlot(slot), true);
    await releaseQueuedIngestionSlot(slot);
    assert.equal(await startIngestionRun(runId), true);
    assert.equal(await startIngestionRun(runId), true);
    assert.ok(await countNewSignalsForRun(runId) >= 0);
    const activity = await getArchiveActivity();
    await finishIngestionRun(runId, { status: "complete", sources: feed.sources, fetched: 1, mapped: 1, added: 1, embedded: 1, embeddingStatus: "ok", activity });
    assert.equal(await startIngestionRun(runId), false);
    const status = await getIngestionStatus();
    assert.equal(status.lastRun?.status, "complete");
    assert.equal(status.lastRun?.fetched, 1);
    const latestFeed = await getLatestIngestionFeedMetadata();
    assert.equal(latestFeed?.sources.github, "ok");
    assert.equal(latestFeed?.partial, feed.partial);
    assert.equal(latestFeed?.activity?.ai.count, activity.ai.count);
    assert.ok(Date.parse(latestFeed!.observedAt) <= Date.now());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("Public feed contacted a source"); };
    try {
      const response = await getPublicSignals();
      assert.equal(response.status, 200);
      const publicFeed = await response.json() as SignalFeed;
      assert.equal(publicFeed.scope, "rolling");
      assert.ok(Date.now() - Date.parse(publicFeed.observedAt) < 10_000);
      assert.ok(publicFeed.events.some((item) => item.id === id));
      assert.equal(publicFeed.sources.github, "ok");
      assert.equal(publicFeed.activity?.ai.count, activity.ai.count);
      const gatewayKey = process.env.AI_GATEWAY_API_KEY;
      const vercelFlag = process.env.VERCEL;
      process.env.AI_GATEWAY_API_KEY = "";
      process.env.VERCEL = "";
      try {
        const answer = await askSymtri(new Request("http://localhost/api/ask", {
          method: "POST", body: JSON.stringify({ question: "What's happening with AI agents?" }),
        }));
        assert.equal(answer.status, 200);
        const result = await answer.json();
        assert.equal(result.scope, "rolling");
        assert.ok(result.events.some((item: SignalEvent) => item.id === id));
      } finally {
        if (gatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
        else process.env.AI_GATEWAY_API_KEY = gatewayKey;
        if (vercelFlag === undefined) delete process.env.VERCEL;
        else process.env.VERCEL = vercelFlag;
      }
    } finally { globalThis.fetch = originalFetch; }
    assert.equal(status.classificationBacklog, 0);
    assert.equal(status.embeddingBacklog, 1);
    await releaseIngestionLease(runId);
    assert.equal(await acquireIngestionLease(competingRunId), true);
    await releaseIngestionLease(competingRunId);
    const rows = await sql`select count(*)::int as count from signal_events where id = ${id}`;
    assert.equal(rows[0].count, 1);
    const archiveEvent: SignalEvent = { ...event, id: archiveId, externalId: `${externalId}-archive`,
      title: "Earlier archived signal", url: `${event.url}/archive`, publishedAt: new Date(Date.now() - 86_400_000).toISOString() };
    await persistSignals({ ...feed, events: [archiveEvent] });
    const rollingSnapshot = rollingFeed(feed, await getStoredFeed(), 0);
    assert.deepEqual(new Set(rollingSnapshot.events.map((item) => item.id)), new Set([id, archiveId]));
    await persistSnapshot({ ...rollingSnapshot, observedAt: "2099-01-03T12:00:00.000Z", sources: feed.sources, partial: feed.partial, activity });
    assert.deepEqual(new Set((await getSnapshotFeed("2099-01-03"))?.events.map((item) => item.id)), new Set([id, archiveId]));
    assert.equal((await getSnapshotFeed("2099-01-03"))?.activity?.ai.count, activity.ai.count);
    await sql`delete from signal_events where id = ${archiveId}`;
    const firstDay = "2099-01-01";
    const secondDay = "2099-01-02";
    feed.observedAt = `${firstDay}T12:00:00.000Z`;
    await persistSnapshot(feed);
    feed.observedAt = `${secondDay}T12:00:00.000Z`;
    await persistSnapshot(feed);
    event.title = "Snapshot updated";
    await persistSnapshot(feed);
    const twoSourceFeed: SignalFeed = {
      ...feed, sources: { "hacker-news": "ok", github: "ok", arxiv: "unavailable" },
    };
    event.title = "Two-source snapshot";
    await persistSnapshot(twoSourceFeed);
    event.title = "One-source retry";
    await persistSnapshot(feed);
    assert.equal((await getSnapshotFeed(secondDay))?.events[0].title, "Two-source snapshot");
    event.title = "Swapped-source retry";
    await persistSnapshot({ ...feed, sources: { "hacker-news": "ok", github: "unavailable", arxiv: "ok" } });
    assert.equal((await getSnapshotFeed(secondDay))?.events[0].title, "Two-source snapshot");
    event.title = "Partial-source retry";
    await persistSnapshot({ ...twoSourceFeed, sources: { "hacker-news": "ok", github: "partial", arxiv: "unavailable" } });
    assert.equal((await getSnapshotFeed(secondDay))?.events[0].title, "Two-source snapshot");
    const completeFeed: SignalFeed = {
      ...feed, partial: false,
      sources: { "hacker-news": "ok", github: "ok", arxiv: "ok" },
    };
    event.title = "Complete snapshot";
    await persistSnapshot(completeFeed);
    event.title = "Partial retry";
    await persistSnapshot(twoSourceFeed);
    const richerFeed: SignalFeed = {
      ...completeFeed,
      events: [
        { ...event, title: "Two-event snapshot" },
        { ...event, id: `${id}-additional`, externalId: `${externalId}-additional`, title: "Additional signal" },
      ],
    };
    await persistSnapshot(richerFeed);
    event.title = "Sparse retry";
    await persistSnapshot(completeFeed);
    const days = await getSnapshotDays();
    assert.deepEqual(days.slice(0, 3).map((item) => item.day), ["2099-01-03", secondDay, firstDay]);
    const historyIndex = await getHistory(new Request("http://localhost/api/history"));
    assert.equal(historyIndex.status, 200);
    assert.equal(historyIndex.headers.get("cache-control"), "no-store");
    assert.deepEqual((await historyIndex.json()).days.slice(0, 3).map((item: { day: string }) => item.day), ["2099-01-03", secondDay, firstDay]);
    const historyDay = await getHistory(new Request(`http://localhost/api/history?day=${secondDay}`));
    assert.equal(historyDay.status, 200);
    const historyFeed = await historyDay.json();
    assert.equal(historyFeed.scope, "history");
    assert.equal(historyFeed.events.length, 2);
    assert.equal((await getHistory(new Request("http://localhost/api/history?day=2099-01-04"))).status, 404);
    const snapshot = await getSnapshotFeed(secondDay);
    assert.equal(snapshot?.events[0].title, "Two-event snapshot");
    assert.equal(snapshot?.events.length, 2);
    assert.equal(snapshot?.partial, false);
    assert.equal(snapshot?.scope, "history");
    const historicDay = "2099-01-04";
    const historicId = `github:${externalId}-historic`;
    const laterId = `github:${externalId}-historic-later`;
    await sql`
      insert into signal_events (id, source, external_id, title, url, summary, published_at, first_seen_at, importance, topics)
      values
        (${historicId}, 'github', ${`${externalId}-historic`}, 'Historical agent research',
          ${`https://github.com/symtri/${externalId}-historic`}, 'An earlier observation',
          '2099-01-04T11:00:00Z', '2099-01-04T12:02:00Z', 50,
          ${sql.json([{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }, { topicId: "markets", subtopicId: null, relevance: 1 }])}::jsonb),
        (${laterId}, 'github', ${`${externalId}-historic-later`}, 'Later agent research',
          ${`https://github.com/symtri/${externalId}-historic-later`}, 'Discovered on a later run',
          '2099-01-04T11:00:00Z', '2099-01-04T13:00:00Z', 50,
          ${sql.json([{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }, { topicId: "markets", subtopicId: null, relevance: 1 }])}::jsonb)
    `;
    await persistSnapshot({ ...feed, observedAt: `${historicDay}T12:00:00.000Z`, events: [{ ...event, id: historicId }] });
    assert.equal((await getSnapshotFeed(historicDay))?.activity, undefined);
    assert.ok(await backfillSnapshotActivity() >= 1);
    assert.equal((await getSnapshotFeed(historicDay))?.activity?.ai.count, 1);
    assert.equal((await getSnapshotFeed(historicDay))?.relationships?.["ai:markets"], 1);
    assert.equal(await backfillSnapshotActivity(), 0);
    await sql`delete from signal_events where id in (${historicId}, ${laterId})`;
    await sql`delete from signal_snapshots where day = ${historicDay}::date`;
    const oldKnowledge = Array.from({ length: 35 }, (_, index) => ({
      id: `${knowledgePrefix}${index}`, external_id: `${externalId}-knowledge-${index}`,
      title: `Quantum meadow quantum meadow specimen ${index}`, summary: `Quantum meadow observations ${index}`,
      url: `https://github.com/symtri/${externalId}-knowledge-${index}`,
    }));
    await sql`
      insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
      select id, 'github', external_id, title, url, summary, now() - interval '20 days', 30, '[]'::jsonb
      from jsonb_to_recordset(${sql.json(oldKnowledge)}::jsonb) as incoming
        (id text, external_id text, title text, url text, summary text)
    `;
    const freshKnowledgeId = `${knowledgePrefix}fresh`;
    await sql`
      insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
      values (${freshKnowledgeId}, 'github', ${`${externalId}-knowledge-fresh`},
        'Quantum meadow update', ${`https://github.com/symtri/${externalId}-knowledge-fresh`},
        'New observations', now(), 30, '[]'::jsonb)
    `;
    const oldRank = await sql`
      select count(*)::int as count from signal_events
      where id like ${`${knowledgePrefix}%`} and id <> ${freshKnowledgeId}
        and ts_rank_cd(to_tsvector('english', title || ' ' || summary), websearch_to_tsquery('english', 'Quantum meadow')) >
          (select ts_rank_cd(to_tsvector('english', title || ' ' || summary), websearch_to_tsquery('english', 'Quantum meadow'))
           from signal_events where id = ${freshKnowledgeId})
    `;
    assert.equal(oldRank[0].count, 35);
    assert.equal((await searchKnowledge("Quantum meadow", null))[0]?.event.id, freshKnowledgeId);
    const exoplanetKnowledgeId = `${knowledgePrefix}exoplanet`;
    await sql`
      insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
      values (${exoplanetKnowledgeId}, 'arxiv', ${`${externalId}-knowledge-exoplanet`},
        'Exoplanet atmospheres observed with JWST', ${`https://arxiv.org/abs/${externalId}-knowledge-exoplanet`},
        'Spectra reveal water vapor in a distant planetary atmosphere.', now(), 30, '[]'::jsonb)
    `;
    assert.equal((await searchKnowledge("What is new in exoplanet research?", null))[0]?.event.id, exoplanetKnowledgeId);
    assert.equal((await searchKnowledge("What do we know about exoplanets?", null))[0]?.event.id, exoplanetKnowledgeId);
    assert.equal((await searchKnowledge("What are people saying about exoplanets?", null))[0]?.event.id, exoplanetKnowledgeId);
    assert.equal((await searchKnowledge("What is new in tropical botany research?", null)).length, 0);
    await sql`delete from signal_events where id like ${`${knowledgePrefix}%`}`;
    console.log("Postgres migrations, API table protection, signal upsert, archive-backed map and Ask, topic lookup, semantic retrieval, relationships, and snapshot preservation passed");
  } finally {
    await sql`delete from signal_events where id in (${id}, ${unclassifiedId}, ${relatedId}, ${weakParentId}, ${sharedThreadId}, ${foreignId}, ${quantumId}, ${cosmicId}, ${archiveId})`;
    await sql`delete from signal_events where id like ${`${crowdPrefix}%`}`;
    await sql`delete from signal_events where id like ${`${knowledgePrefix}%`}`;
    await sql`delete from ingestion_runs where id = ${runId}`;
    await sql`delete from ingestion_lease where run_id in (${runId}, ${competingRunId})`;
    await sql`delete from signal_snapshots where day in ('2099-01-01', '2099-01-02', '2099-01-03', '2099-01-04')`;
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
