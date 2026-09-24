import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { acquireIngestionLease, claimIngestionSlot, countNewSignalsForRun, findSemanticSignals, finishIngestionRun, getIngestionStatus, getKnowledgeGraph, getPendingEmbeddingEvents, getRecentTopicEvents, getRelatedSignals, getSemanticRelationships, getSnapshotDays, getSnapshotFeed, getStoredFeed, hasCurrentSignalEmbeddings, persistEmbeddings, persistSignals, persistSnapshot, rebuildKnowledgeGraph, releaseIngestionLease, releaseQueuedIngestionSlot, searchKnowledge, startIngestionRun } from "../lib/data/storage";
import { EMBEDDING_DIMENSIONS } from "../lib/ai/embed";
import type { SignalEvent, SignalFeed } from "../lib/data/model";

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
const crowdPrefix = `github:${externalId}-crowd-`;
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
  assert.equal((await sql`select count(*)::int as count from pg_indexes where indexname = 'signal_events_topics_gin_idx'`)[0].count, 1);
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
      title: "Software sample", url: `https://github.com/symtri/${externalId}-crowd-${index}`,
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
    const refreshed = await sql`select embedding_input_hash from signal_events where id = ${id}`;
    assert.notEqual(refreshed[0].embedding_input_hash, embedded[0].embedding_input_hash);
    assert.equal(await acquireIngestionLease(runId), true);
    assert.equal(await acquireIngestionLease(competingRunId), false);
    const slot = `hour:${randomUUID()}`;
    assert.equal(await claimIngestionSlot(slot), true);
    assert.equal(await claimIngestionSlot(slot), false);
    await releaseQueuedIngestionSlot(slot);
    assert.equal(await claimIngestionSlot(slot), true);
    await releaseQueuedIngestionSlot(slot);
    await startIngestionRun(runId);
    assert.ok(await countNewSignalsForRun(runId) >= 0);
    await finishIngestionRun(runId, { status: "complete", sources: feed.sources, fetched: 1, mapped: 1, added: 1, embedded: 1, embeddingStatus: "ok" });
    const status = await getIngestionStatus();
    assert.equal(status.lastRun?.status, "complete");
    assert.equal(status.lastRun?.fetched, 1);
    await releaseIngestionLease(runId);
    assert.equal(await acquireIngestionLease(competingRunId), true);
    await releaseIngestionLease(competingRunId);
    const rows = await sql`select count(*)::int as count from signal_events where id = ${id}`;
    assert.equal(rows[0].count, 1);
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
    assert.deepEqual(days.slice(0, 2).map((item) => item.day), [secondDay, firstDay]);
    const snapshot = await getSnapshotFeed(secondDay);
    assert.equal(snapshot?.events[0].title, "Two-event snapshot");
    assert.equal(snapshot?.events.length, 2);
    assert.equal(snapshot?.partial, false);
    assert.equal(snapshot?.scope, "history");
    console.log("Postgres migrations, API table protection, signal upsert, topic lookup beyond the map cap, semantic retrieval, relationships, and snapshot preservation passed");
  } finally {
    await sql`delete from signal_events where id in (${id}, ${unclassifiedId}, ${relatedId}, ${foreignId})`;
    await sql`delete from signal_events where id like ${`${crowdPrefix}%`}`;
    await sql`delete from ingestion_runs where id = ${runId}`;
    await sql`delete from ingestion_lease where run_id in (${runId}, ${competingRunId})`;
    await sql`delete from signal_snapshots where day in ('2099-01-01', '2099-01-02')`;
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
