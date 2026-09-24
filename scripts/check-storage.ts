import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { findSemanticSignals, getSemanticRelationships, getSnapshotDays, getSnapshotFeed, getStoredFeed, hasCurrentSignalEmbeddings, persistEmbeddings, persistSignals, persistSnapshot } from "../lib/data/storage";
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

async function main() {
  const migration = await readFile(new URL("../db/001_signals.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  const vectorMigration = await readFile(new URL("../db/002_embeddings.sql", import.meta.url), "utf8");
  await sql.unsafe(vectorMigration);
  const accessMigration = await readFile(new URL("../db/003_lock_down_api.sql", import.meta.url), "utf8");
  await sql.unsafe(accessMigration);
  const protectedTables = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select relname, relrowsecurity from pg_class
    where relname in ('signal_events', 'signal_snapshots', 'topic_embeddings')
  `;
  assert.equal(protectedTables.length, 3);
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
    event.title = "Updated title";
    assert.equal(await persistSignals(feed), 1);
    const stored = await getStoredFeed();
    const result = stored?.events.find((item) => item.id === id);
    assert.equal(result?.title, "Updated title");
    assert.deepEqual(result?.topics, event.topics);
    assert.equal(await hasCurrentSignalEmbeddings(feed.events), false);
    const fakeEmbedder = async (inputs: string[]) => inputs.map((_, index) => [index + 1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)]);
    assert.ok(await persistEmbeddings(feed, fakeEmbedder) >= 1);
    assert.equal(await persistEmbeddings(feed, fakeEmbedder), 0);
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
    const refreshed = await sql`select embedding_input_hash from signal_events where id = ${id}`;
    assert.notEqual(refreshed[0].embedding_input_hash, embedded[0].embedding_input_hash);
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
    console.log("Postgres migrations, API table protection, signal upsert, embedding cache, semantic retrieval, relationships, and snapshot coverage preservation passed");
  } finally {
    await sql`delete from signal_events where id = ${id}`;
    await sql`delete from signal_snapshots where day in ('2099-01-01', '2099-01-02')`;
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
