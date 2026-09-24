import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { acquireIngestionLease, claimIngestionSlot, countNewSignalsForRun, findSemanticSignals, finishIngestionRun, getIngestionStatus, getKnowledgeGraph, getLatestIngestionFeedMetadata, getPendingEmbeddingEvents, getRecentTopicEvents, getRelatedSignals, getSemanticRelationships, getSnapshotDays, getSnapshotFeed, getStoredFeed, hasCurrentSignalEmbeddings, persistEmbeddings, persistSignals, persistSnapshot, rebuildKnowledgeGraph, refreshStoredClassifications, releaseIngestionLease, releaseQueuedIngestionSlot, searchKnowledge, startIngestionRun } from "../lib/data/storage";
import { EMBEDDING_DIMENSIONS } from "../lib/ai/embed";
import type { SignalEvent, SignalFeed } from "../lib/data/model";
import { rollingFeed } from "../lib/data/rolling";
import { CLASSIFIER_VERSION } from "../lib/data/classify";
import { GET as getPublicSignals } from "../app/api/signals/route";
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
    await finishIngestionRun(runId, { status: "complete", sources: feed.sources, fetched: 1, mapped: 1, added: 1, embedded: 1, embeddingStatus: "ok" });
    assert.equal(await startIngestionRun(runId), false);
    const status = await getIngestionStatus();
    assert.equal(status.lastRun?.status, "complete");
    assert.equal(status.lastRun?.fetched, 1);
    const latestFeed = await getLatestIngestionFeedMetadata();
    assert.equal(latestFeed?.sources.github, "ok");
    assert.equal(latestFeed?.partial, feed.partial);
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
    await persistSnapshot({ ...rollingSnapshot, observedAt: "2099-01-03T12:00:00.000Z", sources: feed.sources, partial: feed.partial });
    assert.deepEqual(new Set((await getSnapshotFeed("2099-01-03"))?.events.map((item) => item.id)), new Set([id, archiveId]));
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
    const snapshot = await getSnapshotFeed(secondDay);
    assert.equal(snapshot?.events[0].title, "Two-event snapshot");
    assert.equal(snapshot?.events.length, 2);
    assert.equal(snapshot?.partial, false);
    assert.equal(snapshot?.scope, "history");
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
    await sql`delete from signal_events where id like ${`${knowledgePrefix}%`}`;
    console.log("Postgres migrations, API table protection, signal upsert, archive-backed map and Ask, topic lookup, semantic retrieval, relationships, and snapshot preservation passed");
  } finally {
    await sql`delete from signal_events where id in (${id}, ${unclassifiedId}, ${relatedId}, ${foreignId}, ${quantumId}, ${cosmicId}, ${archiveId})`;
    await sql`delete from signal_events where id like ${`${crowdPrefix}%`}`;
    await sql`delete from signal_events where id like ${`${knowledgePrefix}%`}`;
    await sql`delete from ingestion_runs where id = ${runId}`;
    await sql`delete from ingestion_lease where run_id in (${runId}, ${competingRunId})`;
    await sql`delete from signal_snapshots where day in ('2099-01-01', '2099-01-02', '2099-01-03')`;
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
