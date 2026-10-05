import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { acquireIngestionLease, backfillSnapshotMetadata, claimIngestionSlot, countNewSignalsForRun, findSemanticSignals, finishIngestionRun, getArchiveActivity, getArchiveChildCounts, getArchiveCount, getArchiveRelationships, getCisaEntryHashes, getSignalEvidence, getArchivedSignal, withStoredEvidence, getConnectionEvents, getIngestionStatus, getKnowledgeGraph, getLatestIngestionFeedMetadata, getPendingEmbeddingEvents, getPersistedCurrentFeed, getRecentTopicEvents, getRelatedSignals, getSemanticRelationships, getSnapshotDays, getSnapshotFeed, getStoredFeed, getTopicPage, hasCurrentSignalEmbeddings, persistCurrentFeed, persistEmbeddings, persistSignals, persistSnapshot, rebuildKnowledgeGraph, refreshStoredClassifications, releaseIngestionLease, releaseQueuedIngestionSlot, searchKnowledge, startIngestionRun } from "../lib/data/storage";
import { EMBEDDING_DIMENSIONS, embeddingModelId } from "../lib/ai/embed";
import type { SignalEvent, SignalFeed } from "../lib/data/model";
import { rollingFeed } from "../lib/data/rolling";
import { regionActivity } from "../lib/data/activity";
import { CLASSIFIER_VERSION } from "../lib/data/classify";
import { GET as getPublicSignals } from "../app/api/signals/route";
import { GET as getHistory } from "../app/api/history/route";
import { availableReadingNoteLanes, claimableReadingNoteCount, claimReadingNoteWorker, enrichBatch, enqueueMissingNotes, releaseReadingNoteWorker, renewReadingNoteWorker, retrieveStoryEvidence, ENRICHMENT_VERSION } from "../lib/data/enrichment";
import { GET as readStory } from "../app/api/story/route";
import { POST as askSymtri } from "../app/api/ask/route";
import { getUniverseCatalog, recordCatalogRevision, seedUniverseCatalog } from "../lib/data/catalog";
import { discoverConcepts, syncArchiveConcepts } from "../lib/data/discovery";
import { questionTopics } from "../lib/ai/ask";
import { fetchActiveFeeds, pollTrialFeeds } from "../lib/data/feed-registry";
import { recoverPausedFeeds } from "../lib/data/feed-registry";
import { checkAskRateLimit, pruneAskRateLimits } from "../lib/data/ask-limit";

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
const organicPrefix = `organic-check-${externalId}`;
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
  const snapshotRelationshipsMigration = await readFile(new URL("../supabase/migrations/20260924013000_snapshot_relationships_backfill.sql", import.meta.url), "utf8");
  await sql.unsafe(snapshotRelationshipsMigration);
  const openAlexMigration = await readFile(new URL("../supabase/migrations/20260924014000_openalex_source.sql", import.meta.url), "utf8");
  await sql.unsafe(openAlexMigration);
  const sourcePreviewMigration = await readFile(new URL("../supabase/migrations/20260924015000_source_preview_index.sql", import.meta.url), "utf8");
  await sql.unsafe(sourcePreviewMigration);
  const organicMigration = await readFile(new URL("../supabase/migrations/20260924016000_organic_graph.sql", import.meta.url), "utf8");
  await sql.unsafe(organicMigration);
  const seedCatalogMigration = await readFile(new URL("../supabase/migrations/20260924017000_seed_catalog.sql", import.meta.url), "utf8");
  await sql.unsafe(seedCatalogMigration);
  const growthScalingMigration = await readFile(new URL("../supabase/migrations/20260924018000_growth_scaling.sql", import.meta.url), "utf8");
  await sql.unsafe(growthScalingMigration);
  const launchControlsMigration = await readFile(new URL("../supabase/migrations/20260924019000_launch_controls.sql", import.meta.url), "utf8");
  await sql.unsafe(launchControlsMigration);
  assert.equal((await sql`select count(*)::int as count from concept_catalog`)[0].count, 76);
  await sql.unsafe(await readFile(new URL("../supabase/migrations/20260928000000_source_evidence.sql", import.meta.url), "utf8"));
  await seedUniverseCatalog();
  assert.equal((await getUniverseCatalog()).topics.length, 10);
  assert.equal((await sql`select public.symtri_canonical_url('https://news.ycombinator.com/item?id=47&utm_source=hn') as url`)[0].url, "news.ycombinator.com/item?id=47");
  assert.equal((await sql`select public.symtri_canonical_url('https://example.com/article?b=2&utm_source=hn&a=1&fbclid=abc') as url`)[0].url, "example.com/article?a=1&b=2");
  assert.equal((await sql`select count(*)::int as count from signal_events where id in (${legacyFirst}, ${legacySecond})`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from signal_observations where signal_id = ${legacyFirst}`)[0].count, 2);
  await sql`delete from signal_events where id = ${legacyFirst}`;
  assert.equal((await sql`select count(*)::int as count from pg_indexes where indexname = 'signal_events_topics_gin_idx'`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from pg_indexes where indexname = 'signal_events_content_key_key'`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from pg_indexes where indexname = 'signal_events_search_idx'`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from pg_indexes where indexname = 'signal_events_source_preview_idx'`)[0].count, 1);
  await sql.unsafe(await readFile(new URL("../supabase/migrations/20260928001000_reading_notes.sql", import.meta.url), "utf8"));
  await sql.unsafe(await readFile(new URL("../supabase/migrations/20261001000000_reading_note_workers.sql", import.meta.url), "utf8"));
  await sql.unsafe(await readFile(new URL("../supabase/migrations/20261004000000_reading_note_failure_code.sql", import.meta.url), "utf8"));
  const protectedTables = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select relname, relrowsecurity from pg_class
    where relname in ('signal_events', 'signal_snapshots', 'topic_embeddings', 'ingestion_lease', 'ingestion_runs', 'knowledge_graph', 'signal_observations',
      'concept_catalog', 'concept_candidates', 'concept_candidate_evidence', 'signal_concepts', 'catalog_revisions', 'source_catalog', 'source_trial_items', 'source_probes',
      'current_feed', 'knowledge_graph_days', 'knowledge_graph_dirty_days', 'ask_request_buckets', 'production_health_checks', 'signal_evidence', 'reading_notes', 'background_context', 'reading_note_workers')
  `;
  assert.equal(protectedTables.length, 24);
  assert.ok(protectedTables.every((table) => table.relrowsecurity));
  const workerSlot=`storage-check:${externalId}`;
  assert.deepEqual(await availableReadingNoteLanes(4),[0,1,2,3]);
  assert.equal(await claimReadingNoteWorker(0,workerSlot),true);
  assert.deepEqual(await availableReadingNoteLanes(4),[1,2,3]);
  assert.equal(await claimReadingNoteWorker(0,workerSlot),false,"A duplicate cron delivery cannot repeat the same lane");
  assert.equal(await claimReadingNoteWorker(0,`${workerSlot}:other`),false,"An active lane excludes another run");
  assert.equal(await renewReadingNoteWorker(0,workerSlot),true);
  await releaseReadingNoteWorker(0,workerSlot);
  assert.deepEqual(await availableReadingNoteLanes(4),[0,1,2,3]);
  assert.equal(await claimReadingNoteWorker(0,workerSlot),false,"A released lane still records its completed cron slot");
  assert.equal(await claimReadingNoteWorker(0,`${workerSlot}:next`),true);
  await releaseReadingNoteWorker(0,`${workerSlot}:next`);
  const quotaTime = new Date("2025-01-01T10:30:00Z");
  const visitorRequest = new Request("https://symtri.com/api/ask", { headers: { "x-vercel-forwarded-for": "203.0.113.10" } });
  for (let attempt = 0; attempt < 60; attempt++) assert.equal(await checkAskRateLimit(visitorRequest, quotaTime), null);
  assert.ok((await checkAskRateLimit(visitorRequest, quotaTime))! > 0);
  const secondVisitor = new Request("https://symtri.com/api/ask", { headers: { "x-vercel-forwarded-for": "203.0.113.11" } });
  assert.equal(await checkAskRateLimit(secondVisitor, quotaTime), null);
  await sql`update ask_request_buckets set requests = 3000 where scope = 'site-day'`;
  assert.ok((await checkAskRateLimit(new Request("https://symtri.com/api/ask", {
    headers: { "x-vercel-forwarded-for": "203.0.113.12" },
  }), quotaTime))! > 0);
  assert.equal(await checkAskRateLimit(visitorRequest, new Date("2025-01-02T11:00:00Z")), null);
  await pruneAskRateLimits(new Date("2025-01-05T00:00:00Z"));
  assert.equal((await sql`select count(*)::int as count from ask_request_buckets`)[0].count, 0);
  assert.equal((await askSymtri(new Request("https://symtri.com/api/ask", { method: "POST",
    body: JSON.stringify({ question: "x".repeat(5_000) }) }))).status, 413);
  assert.equal((await askSymtri(new Request("https://symtri.com/api/ask", { method: "POST",
    body: JSON.stringify({ question: "Explain AI", context: { question: "x".repeat(241) } }) }))).status, 400);
  assert.equal((await askSymtri(new Request("https://symtri.com/api/ask",{method:"POST",body:JSON.stringify({question:"Explain AI",context:{answer:"x".repeat(801)}})}))).status,400);
  const clarification = await askSymtri(new Request("https://symtri.com/api/ask", { method: "POST",
    body: JSON.stringify({ question: "What are their limitations?" }) }));
  assert.equal(clarification.status, 200);
  assert.equal((await clarification.json()).needsClarification, true);
  const event: SignalEvent = {
    id, source: "github", externalId, title: "First title",
    url: `https://github.com/symtri/${externalId}`, summary: "Storage roundtrip",
    publishedAt: new Date(Date.now() + 3_600_000).toISOString(), importance: 50,
    topics: [{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }],
  };
  const feed: SignalFeed = {
    observedAt: new Date().toISOString(), events: [event],
    sources: { "hacker-news": "unavailable", github: "ok", arxiv: "unavailable", openalex: "unavailable" },
    partial: true, scope: "sample",
  };
  try {
    const feedSourceId = `feed-${externalId}`;
    const feedEvent: SignalEvent = { ...event, id: `${feedSourceId}:one`, source: feedSourceId,
      externalId: "one", title: "Independent quantum sensor report", url: `https://feed.example/${externalId}`,
      summary: "An independent technical article about quantum sensing instrumentation." };
    await sql`insert into source_catalog (id, name, kind, feed_url, status)
      values (${feedSourceId}, 'Test publication', 'rss', 'https://feed.example/rss.xml', 'trial')`;
    assert.equal(await persistSignals({ ...feed, events: [feedEvent] }), 1);
    assert.ok(!(await getStoredFeed())?.events.some((item) => item.id === feedEvent.id));
    await sql`update source_catalog set status = 'active' where id = ${feedSourceId}`;
    await recordCatalogRevision();
    assert.equal((await getUniverseCatalog()).sourceLabels[feedSourceId], "Test publication");
    assert.ok((await getStoredFeed())?.events.some((item) => item.id === feedEvent.id));
    assert.equal((await sql`select source from signal_observations where source = ${feedSourceId} and external_id = 'one'`)[0]?.source, feedSourceId);
    await sql`delete from signal_events where id = ${feedEvent.id}`;
    await sql`delete from source_catalog where id = ${feedSourceId}`;
    await recordCatalogRevision();
    const trialSourceId = `feed-trial-${externalId}`;
    await sql`insert into source_catalog (id, name, kind, feed_url, status)
      values (${trialSourceId}, 'Trial publication', 'rss', 'https://trial.example/rss.xml', 'trial')`;
    const trialEvents: SignalEvent[] = Array.from({ length: 6 }, (_, index) => ({ ...event,
      id: `${trialSourceId}:${index}`, source: trialSourceId, externalId: String(index),
      title: `Quantum sensor trial ${index}`, url: `https://trial.example/${externalId}/${index}`,
      summary: `A technical report about quantum sensor system ${index} with detailed research observations.`,
      publishedAt: new Date().toISOString(),
    }));
    const trialLoad = async () => trialEvents;
    assert.equal(await pollTrialFeeds(new Date(Date.now() - 2 * 86400000), trialLoad), 0);
    assert.equal(await pollTrialFeeds(new Date(Date.now() - 86400000), trialLoad), 0);
    assert.equal(await pollTrialFeeds(new Date(), trialLoad), 1);
    assert.equal((await sql`select status from source_catalog where id = ${trialSourceId}`)[0].status, "active");
    assert.equal((await fetchActiveFeeds(new Date())).sources[trialSourceId], "ok");
    assert.ok((await getStoredFeed())?.events.some((item) => item.source === trialSourceId));
    const failedAt = new Date();
    await sql`update source_catalog set consecutive_failures = 2,
      last_checked_at = ${new Date(failedAt.getTime() - 7 * 3_600_000)} where id = ${trialSourceId}`;
    assert.equal((await fetchActiveFeeds(failedAt, async () => { throw new Error("Temporary outage"); })).sources[trialSourceId], "unavailable");
    assert.equal((await sql`select status, pause_reason from source_catalog where id = ${trialSourceId}`)[0].pause_reason, "failures");
    const recovered = await recoverPausedFeeds(new Date(failedAt.getTime() + 25 * 3_600_000), trialLoad);
    assert.equal(recovered.sources[trialSourceId], "ok");
    assert.equal((await sql`select status from source_catalog where id = ${trialSourceId}`)[0].status, "active");
    await sql`update source_catalog set status = 'paused', pause_reason = 'manual',
      last_checked_at = ${failedAt} where id = ${trialSourceId}`;
    assert.deepEqual((await recoverPausedFeeds(new Date(failedAt.getTime() + 50 * 3_600_000), trialLoad)).sources, {});
    await sql`delete from signal_events where source = ${trialSourceId}`;
    await sql`delete from source_catalog where id = ${trialSourceId}`;
    await recordCatalogRevision();
    const rotationPrefix = `feed-rotation-${externalId}`;
    const rotationRows = Array.from({ length: 60 }, (_, index) => ({
      id: `${rotationPrefix}-${index}`, name: `Dormant feed ${index}`, feed_url: `https://rotation.example/${index}.xml`,
    }));
    await sql`insert into source_catalog (id, name, kind, feed_url, status, promoted_at, last_checked_at)
      select id, name, 'rss', feed_url, 'active', now() - interval '40 days', now()
      from jsonb_to_recordset(${sql.json(rotationRows)}::jsonb) as incoming(id text, name text, feed_url text)`;
    await sql`update source_catalog set last_checked_at = now() - interval '7 hours' where id like ${`${rotationPrefix}%`}`;
    const firstFeedTurn = await fetchActiveFeeds(new Date(), async () => [event]);
    assert.equal(firstFeedTurn.events.length, 10);
    assert.equal(Object.keys(firstFeedTurn.sources).length, 60);
    assert.equal(Object.values(firstFeedTurn.sources).filter((status) => status === "partial").length, 50);
    const secondFeedTurn = await fetchActiveFeeds(new Date(), async () => [event]);
    assert.equal(secondFeedTurn.events.length, 10);
    const replacementId = `${rotationPrefix}-replacement`;
    await sql`insert into source_catalog (id, name, kind, feed_url, status)
      values (${replacementId}, 'Fresh publication', 'rss', 'https://rotation.example/fresh.xml', 'trial')`;
    const replacementEvents = Array.from({ length: 6 }, (_, index) => ({ ...event,
      id: `${replacementId}:${index}`, source: replacementId, externalId: String(index),
      title: `Fresh quantum instrument ${index}`, url: `https://rotation.example/new/${externalId}/${index}`,
      summary: `New research report about quantum instruments ${index}.`, publishedAt: new Date().toISOString(),
    }));
    const replacementLoad = async () => replacementEvents;
    await pollTrialFeeds(new Date(Date.now() - 2 * 86400000), replacementLoad);
    await pollTrialFeeds(new Date(Date.now() - 86400000), replacementLoad);
    assert.equal(await pollTrialFeeds(new Date(), replacementLoad), 1);
    assert.equal((await sql`select status from source_catalog where id = ${replacementId}`)[0].status, "active");
    assert.equal((await sql`select count(*)::int as count from source_catalog where id like ${`${rotationPrefix}%`} and status = 'active'`)[0].count, 60);
    assert.equal((await sql`select count(*)::int as count from source_catalog where id like ${`${rotationPrefix}%`} and status = 'paused'`)[0].count, 1);
    await sql`delete from signal_events where source = ${replacementId}`;
    await sql`delete from source_catalog where id like ${`${rotationPrefix}%`}`;
    const journalArticle: SignalEvent = { ...event, id: `openalex:${externalId}-journal`, source: "openalex",
      externalId: `${externalId}-journal`, title: "Journal study of AI agents", url: `https://doi.org/10.1234/${externalId}` };
    assert.equal(await persistSignals({ ...feed, events: [journalArticle] }), 1);
    assert.equal(await persistSignals({ ...feed, events: [journalArticle] }), 0);
    assert.equal((await sql`select source from signal_observations where source = 'openalex' and external_id = ${journalArticle.externalId}`)[0]?.source, "openalex");
    await sql`delete from signal_events where id = ${journalArticle.id}`;
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
    await sql`update source_catalog set status = 'paused' where id = 'github'`;
    assert.ok((await getStoredFeed())?.events.some((item) => item.id === id));
    assert.ok(await getArchiveCount() > 0);
    await sql`update source_catalog set status = 'active' where id = 'github'`;
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
    const beforeMissingHash = await getIngestionStatus();
    await sql`update signal_events set embedding_input_hash = null where id = ${id}`;
    const withMissingHash = await getIngestionStatus();
    assert.equal(withMissingHash.vectors, beforeMissingHash.vectors - 1);
    assert.equal(withMissingHash.embeddingBacklog, beforeMissingHash.embeddingBacklog + 1);
    assert.ok((await getPendingEmbeddingEvents()).some((item) => item.id === id));
    assert.equal(await hasCurrentSignalEmbeddings(feed.events), false);
    assert.equal(await persistEmbeddings(feed, fakeEmbedder), 1);
    assert.equal((await getIngestionStatus()).embeddingBacklog, beforeMissingHash.embeddingBacklog);
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
    await sql`update signal_events set classifier_version=0,classification_input=${sql.json({title:"Biological factor identity in plant cells",summary:"Genome expression and biological factors",categories:["q-bio"]})} where id=${sharedThreadId}`;
    assert.ok(!(await getRelatedSignals(id)).some(item=>item.id===sharedThreadId),"Stale thread tags cannot lower the related-source similarity threshold");

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
    const journalPreviewId = `openalex:${externalId}-crowd-journal`;
    await sql`
      insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
      values (${journalPreviewId}, 'openalex', ${`${externalId}-preview-journal`},
        'Stellarator plasma research', ${`https://doi.org/10.1234/${externalId}-preview`},
        'A recently discovered journal paper about fusion energy', now() - interval '12 hours', 25,
        ${sql.json([{ topicId: "energy", subtopicId: "energy-fusion", relevance: 1 }])}::jsonb)
    `;
    const balancedPreview = await getStoredFeed();
    assert.equal(balancedPreview?.events.length, 300);
    assert.ok(balancedPreview.events.some((item) => item.id === journalPreviewId));
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
    const crowdedEvidenceId = `${crowdPrefix}battery-recycling`;
    await sql`insert into signal_evidence(signal_id,source,external_id,body,content_hash,retrieved_at)
      values(${crowdedEvidenceId},'github',${`${externalId}-battery-recycling`},${sql.json({text:"The authors describe recovery of cathode materials from spent batteries. ".repeat(4),kind:"repository",url:`https://github.com/symtri/${externalId}-battery-recycling`,attribution:"Repository authors",license:null,retrievedAt:new Date().toISOString()})},'crowded-evidence',now())`;
    assert.ok((await getRecentTopicEvents([{id:"energy",childId:"energy-battery-storage"}],true)).some(item=>item.id===crowdedEvidenceId),"Ask reserves retained evidence beyond recent upload bursts");
    const firstBatteryPage = await getTopicPage("energy", "energy-battery-storage", null, 20);
    assert.equal(firstBatteryPage.events.length, 20);
    assert.ok(firstBatteryPage.nextCursor);
    const secondBatteryPage = await getTopicPage("energy", "energy-battery-storage", firstBatteryPage.nextCursor, 20);
    assert.ok(!firstBatteryPage.events.some((item) => secondBatteryPage.events.some((next) => next.id === item.id)));
    const thirdBatteryPage = await getTopicPage("energy", "energy-battery-storage", secondBatteryPage.nextCursor, 20);
    assert.ok(thirdBatteryPage.events.some((item) => item.id === `${crowdPrefix}battery-recycling`));
    assert.ok((await getArchiveChildCounts(new Date(Date.now() + 4 * 3_600_000)))["energy-battery-storage"] >= 42);
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
    const connectionSources = await getConnectionEvents("ai", "markets");
    assert.deepEqual(connectionSources.map((item) => item.id), [`${crowdPrefix}link-recent-1`, `${crowdPrefix}link-recent-2`]);
    assert.deepEqual((await getConnectionEvents("markets", "ai")).map((item) => item.id), connectionSources.map((item) => item.id));
    assert.ok((await getConnectionEvents("ai", "markets", true)).some((item) => item.id === `${crowdPrefix}link-expired`));
    assert.ok(!(await getConnectionEvents("ai", "software")).some((item) => item.id === `${crowdPrefix}link-recent-1`));
    await rebuildKnowledgeGraph(recentRelationships);
    assert.equal((await getKnowledgeGraph())?.relationships["ai:markets"], 3);
    assert.match((await getKnowledgeGraph())!.updatedAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal((await getKnowledgeGraph())?.recentRelationships?.["ai:markets"], 2);
    await sql`update source_catalog set status = 'paused' where id = 'github'`;
    assert.deepEqual(await getConnectionEvents("ai", "markets"), []);
    await rebuildKnowledgeGraph(await getArchiveRelationships());
    assert.equal((await getKnowledgeGraph())?.relationships["ai:markets"], undefined);
    await sql`update source_catalog set status = 'active' where id = 'github'`;
    await rebuildKnowledgeGraph(await getArchiveRelationships());
    assert.equal((await getKnowledgeGraph())?.relationships["ai:markets"], 3);
    assert.equal((await (await getPublicSignals()).json() as SignalFeed).relationships?.["ai:markets"], 2);
    await sql`insert into knowledge_graph_dirty_days(day) select date '2000-01-01'+day_offset from generate_series(0,30) as series(day_offset) on conflict do nothing`;
    assert.equal(await rebuildKnowledgeGraph(recentRelationships),30);
    assert.equal(await getKnowledgeGraph(),null);
    assert.equal(await rebuildKnowledgeGraph(recentRelationships),1);
    assert.equal((await getKnowledgeGraph())?.relationships["ai:markets"],3);
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
      const sourceQuestion = await askSymtri(new Request("http://localhost/api/ask", {
        method:"POST",body:JSON.stringify({question:"What limitations does this source report?",context:{signalId:`${crowdPrefix}battery-recycling`}}),
      }));
      assert.equal(sourceQuestion.status,200);
      assert.deepEqual((await sourceQuestion.json()).events.map((item:SignalEvent)=>item.id),[`${crowdPrefix}battery-recycling`]);
      const followUp = await askSymtri(new Request("http://localhost/api/ask", {
        method: "POST", body: JSON.stringify({ question: "Explain it", context: { subject: "battery recycling" } }),
      }));
      assert.equal(followUp.status, 200);
      assert.deepEqual((await followUp.json()).events.map((item: SignalEvent) => item.id), [`${crowdPrefix}battery-recycling`]);
      const comparisonSources: SignalEvent[] = [
        { ...event, id: `${crowdPrefix}comparison-coding`, externalId: `${externalId}-comparison-coding`,
          url: `https://github.com/symtri/${externalId}-comparison-coding`, title: "Coding agents modify repositories",
          summary: "Coding agents use tools to modify software repositories.", publishedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
          topics: [{ topicId: "ai", subtopicId: "ai-coding-agents", relevance: 1 }] },
        { ...event, id: `${crowdPrefix}comparison-models`, externalId: `${externalId}-comparison-models`,
          url: `https://github.com/symtri/${externalId}-comparison-models`, title: "Language models predict sequences",
          summary: "Language models predict sequences from text context.", publishedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
          topics: [{ topicId: "ai", subtopicId: "ai-language-models", relevance: 1 }] },
      ];
      await persistSignals({ ...feed, events: comparisonSources });
      const comparison = await askSymtri(new Request("http://localhost/api/ask", {
        method: "POST", body: JSON.stringify({ question: "Compare coding agents and language models" }),
      }));
      assert.equal(comparison.status, 200);
      const compared = await comparison.json();
      assert.equal(compared.intent, "comparison");
      assert.ok(compared.evidenceGroups.every((group: { eventIds: string[] }) => group.eventIds.length > 0));
      assert.ok(comparisonSources.every((source) => compared.events.some((item: SignalEvent) => item.id === source.id)));
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
    await sql`delete from signal_events where id = ${journalPreviewId}`;
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
    await persistCurrentFeed({ ...(await getStoredFeed())!, observedAt: new Date().toISOString(),
      sources: feed.sources, partial: feed.partial, activity, archiveCount: await getArchiveCount(),
      childCounts: await getArchiveChildCounts(), catalog: await getUniverseCatalog() });
    assert.equal((await getPersistedCurrentFeed())?.archiveCount, await getArchiveCount());
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
    const embeddingRows = Array.from({ length: 205 }, (_, index) => ({
      id: `${crowdPrefix}embed-${index}`, external_id: `${externalId}-embed-${index}`,
      title: `Distinct research signal ${index}`, url: `https://github.com/symtri/${externalId}-embed-${index}`,
      summary: `Embedding queue item ${index}`,
    }));
    await sql`
      insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
      select id, 'github', external_id, title, url, summary, now(), 30, '[]'::jsonb
      from jsonb_to_recordset(${sql.json(embeddingRows)}::jsonb) as incoming
        (id text, external_id text, title text, url text, summary text)
    `;
    let embeddingBatches = 0;
    let pendingEmbeddings = await getPendingEmbeddingEvents();
    assert.equal(pendingEmbeddings.length, 200);
    while (pendingEmbeddings.length && embeddingBatches < 3) {
      await persistEmbeddings({ ...feed, events: pendingEmbeddings }, fakeEmbedder);
      embeddingBatches++;
      pendingEmbeddings = await getPendingEmbeddingEvents();
    }
    assert.equal(embeddingBatches, 2);
    assert.equal(pendingEmbeddings.length, 0);
    assert.equal((await sql`select count(*)::int as count from signal_events
      where id like ${`${crowdPrefix}embed-%`} and embedding is not null`)[0].count, 205);
    await sql`delete from signal_events where id like ${`${crowdPrefix}embed-%`}`;
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
    const snapshotCatalog = await getUniverseCatalog();
    await persistSnapshot({ ...rollingSnapshot, observedAt: "2099-01-03T12:00:00.000Z", sources: feed.sources, partial: feed.partial, activity, catalog: snapshotCatalog });
    assert.deepEqual(new Set((await getSnapshotFeed("2099-01-03"))?.events.map((item) => item.id)), new Set([id, archiveId]));
    assert.equal((await getSnapshotFeed("2099-01-03"))?.activity?.ai.count, activity.ai.count);
    assert.equal((await getSnapshotFeed("2099-01-03"))?.catalog?.revision, snapshotCatalog.revision);
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
      ...feed, sources: { "hacker-news": "ok", github: "ok", arxiv: "unavailable", openalex: "unavailable" },
    };
    event.title = "Two-source snapshot";
    await persistSnapshot(twoSourceFeed);
    event.title = "One-source retry";
    await persistSnapshot(feed);
    assert.equal((await getSnapshotFeed(secondDay))?.events[0].title, "Two-source snapshot");
    event.title = "Swapped-source retry";
    await persistSnapshot({ ...feed, sources: { "hacker-news": "ok", github: "unavailable", arxiv: "ok", openalex: "unavailable" } });
    assert.equal((await getSnapshotFeed(secondDay))?.events[0].title, "Two-source snapshot");
    event.title = "Partial-source retry";
    await persistSnapshot({ ...twoSourceFeed, sources: { "hacker-news": "ok", github: "partial", arxiv: "unavailable", openalex: "unavailable" } });
    assert.equal((await getSnapshotFeed(secondDay))?.events[0].title, "Two-source snapshot");
    const completeFeed: SignalFeed = {
      ...feed, partial: false,
      sources: { "hacker-news": "ok", github: "ok", arxiv: "ok", openalex: "unavailable" },
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
    assert.ok(days.slice(0, 3).every((item) => (item.archiveCount ?? 0) > 0));
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
    assert.equal((await getSnapshotFeed(historicDay))?.relationships, undefined);
    const archiveAtCapture = Number((await sql`select count(*)::int as count from signal_events
      where first_seen_at <= '2099-01-04T12:05:00Z'::timestamptz`)[0].count);
    assert.equal((await getSnapshotFeed(historicDay))?.archiveCount, archiveAtCapture);
    assert.equal((await getSnapshotDays()).find((item) => item.day === historicDay)?.archiveCount, archiveAtCapture);
    await sql.unsafe(snapshotRelationshipsMigration);
    assert.equal((await getSnapshotFeed(historicDay))?.relationships?.["ai:markets"], 1);
    assert.ok(await backfillSnapshotMetadata() >= 1);
    assert.equal((await getSnapshotFeed(historicDay))?.activity?.ai.count, 1);
    assert.equal((await getSnapshotFeed(historicDay))?.relationships?.["ai:markets"], 1);
    assert.equal((await getSnapshotFeed(historicDay))?.archiveCount, archiveAtCapture);
    assert.equal((await getSnapshotDays()).find((item) => item.day === historicDay)?.archiveCount, archiveAtCapture);
    assert.equal(await backfillSnapshotMetadata(), 0);
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
    const organicRows = Array.from({ length: 12 }, (_, index) => ({
      id: `${organicPrefix}:${index}`, source: ["hacker-news", "github", "arxiv"][index % 3],
      external_id: `${externalId}-organic-${index}`, title: `Orbital Knitting ${index} research`,
      url: `https://organic-${index % 3}.example/${externalId}/${index}`,
      summary: `Orbital knitting systems and experiments number ${index} explore a new technical field.`,
      published_at: new Date(Date.now() - (index % 4) * 86400000).toISOString(),
    }));
    await sql`insert into signal_events (id, source, external_id, title, url, summary, published_at, importance, topics)
      select id, source, external_id, title, url, summary, published_at::timestamptz, 30, '[]'::jsonb
      from jsonb_to_recordset(${sql.json(organicRows)}::jsonb) as incoming
        (id text, source text, external_id text, title text, url text, summary text, published_at text)`;
    await sql`update signal_events set embedding = ${`[${Array(256).fill(.1).join(",")}]`}::vector(256), embedding_model = ${embeddingModelId()}
      where id like ${`${organicPrefix}%`}`;
    const discovery = await discoverConcepts();
    assert.equal(discovery.promoted, 1);
    const organicCatalog = await getUniverseCatalog();
    const organicPoint = organicCatalog.topics.find((topic) => topic.name === "Orbital Knitting");
    assert.ok(organicPoint);
    assert.deepEqual(questionTopics("What is new in orbital knitting?", organicCatalog), [{ id: organicPoint.id, childId: null }]);
    assert.ok(await syncArchiveConcepts() >= 12);
    assert.equal((await getArchiveActivity(new Date(), organicCatalog))[organicPoint.id].count, 12);
    await sql`delete from signal_events where id like ${`${organicPrefix}%`}`;
    const evidenceInput = { text: "Full retained NASA mission evidence with a supported finding.", kind: "feed" as const,
      url: event.url, attribution: "NASA", license: null, retrievedAt: new Date().toISOString() };
    const evidenceEvents: SignalEvent[] = [
      { ...event, id: `nasa:${externalId}`, source: "nasa", externalId, evidence: evidenceInput },
      { ...event, id: `nasa-jpl:${externalId}`, source: "nasa-jpl", externalId, evidence: { ...evidenceInput, attribution: "NASA JPL" } },
      { ...event, id: `cisa:${externalId}`, source: "cisa", externalId, evidence: { ...evidenceInput, kind: "advisory", attribution: "CISA", metadata: { entryHash: "fixture-hash" } } },
    ];
    assert.equal(await persistSignals({ ...feed, events: evidenceEvents }), 0);
    const evidenceRows = await sql<{ signal_id: string; body: { text: string }; content_hash: string }[]>`
      select signal_id, body, content_hash from signal_evidence where signal_id = ${id} order by source`;
    assert.equal(evidenceRows.length, 3);
    assert.equal((await getCisaEntryHashes())[externalId], "fixture-hash");
    assert.equal((await getSignalEvidence(id)).length, 3);
    await sql`update source_catalog set status = 'paused' where id = 'cisa'`;
    assert.equal((await getSignalEvidence(id)).length, 2);
    await sql`update source_catalog set status = 'active' where id = 'cisa'`;
    assert.ok(evidenceRows.every((row) => row.body.text === evidenceInput.text && row.signal_id === id));
    await persistSignals({ ...feed, events: evidenceEvents.map((item) => ({ ...item,
      evidence: { ...item.evidence!, retrievedAt: new Date(Date.now() + 1000).toISOString() } })) });
    assert.deepEqual((await sql`select content_hash from signal_evidence where signal_id = ${id} order by source`).map((row) => row.content_hash), evidenceRows.map((row) => row.content_hash));
    const releaseId=`hacker-news:${externalId}-release`;
    const releaseUrl=`https://github.com/symtri/${externalId}/releases/tag/v1.2.3`;
    const releaseEvent:SignalEvent={...event,id:releaseId,source:"hacker-news",externalId:`${externalId}-release`,url:releaseUrl,title:"Repository v1.2.3 release",summary:"A release announcement"};
    await persistSignals({...feed,events:[releaseEvent]});
    const releaseCalls:string[]=[];
    const releaseBody="The maintainers added reproducible build support and documented its compatibility limits. ".repeat(4);
    const enrichedRelease=await retrieveStoryEvidence(releaseEvent,async(url)=>{releaseCalls.push(url);return {url,contentType:"application/json",text:JSON.stringify({body:releaseBody,html_url:releaseUrl,published_at:"2026-09-27T12:00:00Z",draft:false})};});
    assert.deepEqual(releaseCalls,[`https://api.github.com/repos/symtri/${externalId}/releases/tags/v1.2.3`]);
    assert.equal(enrichedRelease.evidence?.kind,"repository");assert.equal(enrichedRelease.evidence?.text,releaseBody.trim());
    assert.equal(enrichedRelease.evidence?.metadata?.contentType,"release notes");
    assert.equal((await getSignalEvidence(releaseId))[0].body.metadata?.releaseTag,"v1.2.3");
    await sql`delete from signal_events where id=${releaseId}`;
    const archivedId=`openalex:${externalId}-archived-abstract`;
    const archivedEvent:SignalEvent={...event,id:archivedId,source:"openalex",externalId:`${externalId}-archived-abstract`,
      url:`https://doi.org/10.9999/${externalId}`,title:"Archived abstract about orbital methods",
      summary:"The archived journal abstract describes a measured orbital method under controlled conditions. The authors compare the new method with a prior technique and report the boundary of the evaluation. ".repeat(2)};
    await persistSignals({...feed,events:[archivedEvent]});
    const archivedCalls:string[]=[];
    const recoveredAbstract=await retrieveStoryEvidence(archivedEvent,async(url)=>{archivedCalls.push(url);throw new Error("Publisher should not be fetched");});
    assert.deepEqual(archivedCalls,[]);
    assert.equal(recoveredAbstract.evidence?.kind,"abstract");
    assert.equal((await getSignalEvidence(archivedId))[0].body.metadata?.archivedExcerpt,true);
    await sql`delete from signal_events where id=${archivedId}`;
    const shortAbstractId=`europe-pmc:${externalId}-short-abstract`;
    const shortAbstract="A newly observed allele differs from a previously recorded allele by one nucleotide substitution in a typed sample.";
    const shortAbstractEvent:SignalEvent={...event,id:shortAbstractId,source:"europe-pmc",externalId:`MED-${externalId}-short`,
      url:`https://doi.org/10.9999/${externalId}-short`,title:"A short Europe PMC abstract",summary:shortAbstract,
      evidence:{text:shortAbstract,kind:"abstract",url:`https://doi.org/10.9999/${externalId}-short`,attribution:"Study authors",license:null,retrievedAt:new Date().toISOString()}};
    await persistSignals({...feed,events:[shortAbstractEvent]});
    const shortCalls:string[]=[];
    const retainedAbstract=await retrieveStoryEvidence(shortAbstractEvent,async(url)=>{shortCalls.push(url);throw new Error("Publisher should not be fetched");});
    assert.deepEqual(shortCalls,[]);
    assert.equal(retainedAbstract.evidence?.text,shortAbstract);
    await sql`delete from signal_events where id=${shortAbstractId}`;
    const discussionId=`hacker-news:${externalId}-discussion`;
    const discussionEvent:SignalEvent={...event,id:discussionId,source:"hacker-news",externalId:"123456789",
      url:`https://example.org/${externalId}/unreadable`,title:"A linked page that cannot be extracted",summary:"Hacker News discussion."};
    await persistSignals({...feed,events:[discussionEvent]});
    const comment="A commenter describes a specific result from the linked project and explains the limited circumstances in which they observed it. ".repeat(2);
    const recoveredDiscussion=await retrieveStoryEvidence(discussionEvent,async(url)=>({url,contentType:url.includes("firebaseio")?"application/json":"text/html",
      text:url.endsWith("123456789.json")?JSON.stringify({type:"story",kids:[987654321]}):url.endsWith("987654321.json")?JSON.stringify({type:"comment",by:"observer",text:comment}):"<html><main>Short</main></html>"}));
    assert.equal(recoveredDiscussion.evidence?.kind,"discussion");
    assert.equal(recoveredDiscussion.evidence?.url,"https://news.ycombinator.com/item?id=123456789");
    assert.equal((await getSignalEvidence(discussionId))[0].body.kind,"discussion");
    await sql`delete from signal_events where id=${discussionId}`;
    // An unchanged observation keeps a ready note; changed content invalidates it
    // and prevents a worker holding the old revision from publishing stale prose.
    const noteRevision=Number((await sql`select revision from reading_notes where signal_id=${id}`)[0].revision);
    const fixtureNote={explanation:"Supported fixture",claims:[],questions:[],sourceKind:"feed",evidenceSource:"nasa",createdAt:new Date().toISOString(),context:[]};
    await sql`update reading_notes set version=${ENRICHMENT_VERSION},status='ready',note=${sql.json(fixtureNote)},claim_token='old-worker' where signal_id=${id}`;
    assert.equal((await readStory(new Request(`http://localhost/api/story?id=${encodeURIComponent(id)}`))).status,200);
    const noteResponse=await readStory(new Request(`http://localhost/api/story?id=${encodeURIComponent(id)}`));
    assert.equal((await noteResponse.json()).note.explanation,"Supported fixture");
    await sql`update source_catalog set status='paused' where id='nasa'`;
    assert.equal((await (await readStory(new Request(`http://localhost/api/story?id=${encodeURIComponent(id)}`))).json()).note,null);
    await sql`update source_catalog set status='active' where id='nasa'`;
    await persistSignals({...feed,events:evidenceEvents});
    assert.equal((await sql`select status from reading_notes where signal_id=${id}`)[0].status,"ready");
    await sql`update signal_events set summary=summary || ' Updated source content.' where id=${id}`;
    const requeued=(await sql`select status,note,revision from reading_notes where signal_id=${id}`)[0];
    assert.equal(requeued.status,"pending");assert.equal(requeued.note,null);assert.equal(Number(requeued.revision),noteRevision+1);
    assert.equal((await sql`update reading_notes set status='ready',note=${sql.json(fixtureNote)} where signal_id=${id} and revision=${noteRevision} and claim_token='old-worker' returning signal_id`).length,0);
    const hubId=`hugging-face:${externalId}-updated`;
    const hubCreated=new Date(Date.now()-20*86400000).toISOString();
    const hubUpdated=new Date().toISOString();
    const hubEvent:SignalEvent={...event,id:hubId,source:"hugging-face",externalId:`${externalId}-hub`,url:`https://huggingface.co/qa/${externalId}`,title:"QA model release",summary:"Documented model release",publishedAt:hubCreated};
    assert.equal(await persistSignals({...feed,events:[hubEvent]}),1);
    assert.ok(!(await getStoredFeed())?.events.some(item=>item.id===hubId));
    assert.equal(await persistSignals({...feed,events:[{...hubEvent,title:"QA model update",summary:"Documented model update",publishedAt:hubUpdated}]}),0);
    assert.equal((await getArchivedSignal(hubId))?.publishedAt,hubUpdated);
    assert.ok((await getStoredFeed())?.events.some(item=>item.id===hubId));
    assert.equal(Number((await sql`select count(*)::int as count from signal_observations where signal_id=${hubId}`)[0].count),1);
    await sql`delete from signal_events where id=${hubId}`;
    const connectionId=`github:${externalId}-civil-connection`;
    const connectionEvent:SignalEvent={...event,id:connectionId,externalId:`${externalId}-civil-connection`,url:`https://example.org/${externalId}-civil-connection`,title:"Nuclear reactors provide electricity for AI data centers",summary:"A civil nuclear power project supplies electricity to AI infrastructure in a data center.",publishedAt:hubCreated,topics:[{topicId:"energy",subtopicId:"energy-nuclear",relevance:1},{topicId:"ai",subtopicId:"ai-infrastructure",relevance:1}]};
    await persistSignals({...feed,events:[connectionEvent]});
    const connectionAnswer=await askSymtri(new Request("http://localhost/api/ask",{method:"POST",body:JSON.stringify({question:"What connects nuclear energy and AI?"})}));
    assert.equal(connectionAnswer.status,200);
    assert.deepEqual((await connectionAnswer.json()).events.map((item:SignalEvent)=>item.id),[connectionId]);
    await sql`delete from signal_events where id=${connectionId}`;
    // Retained-only subjects remain searchable, active-source filtering applies,
    // and vectors are built from retained evidence rather than the display excerpt.
    const retrievalText="The study examines zeolite membranes for xenon separation under controlled laboratory conditions. ".repeat(3);
    await persistSignals({...feed,events:evidenceEvents.map(item=>({...item,evidence:{...item.evidence!,text:retrievalText}}))});
    const retainedMatches=await searchKnowledge("Explain xenon separation",null);
    assert.equal(retainedMatches[0]?.event.id,id);
    assert.equal(retainedMatches[0]?.event.evidence?.text,retrievalText);
    const [retainedEvent]=await withStoredEvidence([(await getArchivedSignal(id))!]);
    await persistEmbeddings({...feed,events:[retainedEvent]},fakeEmbedder);
    assert.equal(await hasCurrentSignalEmbeddings([{...retainedEvent,evidence:undefined}]),true);
    assert.equal(await hasCurrentSignalEmbeddings([{...retainedEvent,evidence:undefined}],false),false);
    const staleEmbedding=await persistEmbeddings({...feed,events:[{...retainedEvent,evidence:{...retainedEvent.evidence!,text:retrievalText+" New findings."}}]},async inputs=>{
      await sql`update signal_events set summary=summary || ' Changed during embedding.' where id=${id}`;
      return fakeEmbedder(inputs);
    });
    assert.ok(staleEmbedding>0); // Work was computed, but its stale vector cannot be stored.
    assert.equal((await sql`select embedding from signal_events where id=${id}`)[0].embedding,null);
    await sql`update source_catalog set status='paused' where id in ('nasa','nasa-jpl','cisa')`;
    assert.equal((await searchKnowledge("Explain xenon separation",null)).length,0);
    await sql`update source_catalog set status='active' where id in ('nasa','nasa-jpl','cisa')`;
    // Exercise the actual queue worker with a deterministic synthesis seam and no
    // external calls. Only this isolated database's target fixture is eligible.
    await sql`update reading_notes set status='ready' where signal_id<>${id}`;
    await sql`update reading_notes set status='pending',attempts=0,retry_at=now() where signal_id=${id}`;
    assert.equal(await claimableReadingNoteCount(4),1);
    await sql`update reading_notes set retry_at=now()+interval '1 hour' where signal_id=${id}`;
    assert.equal(await claimableReadingNoteCount(4),0);
    await sql`update reading_notes set retry_at=now() where signal_id=${id}`;
    await sql`update signal_events set importance=1000 where id=${id}`;
    const retainedText="A retained source passage describing the fixture study and its explicitly reported limitations. ".repeat(3);
    await persistSignals({...feed,events:evidenceEvents.map(item=>({...item,evidence:{...item.evidence!,text:retainedText}}))});
    const priorGateway=process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY="local-test-placeholder";
    try {
      const synthesize=async()=>({summary:"A deterministic source-backed fixture note.",citedEventIds:[id],claims:[{text:"A deterministic source-backed fixture note.",evidence:[{sourceId:id,quote:retainedText.slice(0,90)}]}]});
      await sql`update reading_notes set status='ready' where signal_id=${id}`;
      const fairEvents:SignalEvent[]=[0,1,2].map(index=>({...event,id:`github:${externalId}-fair-${index}`,externalId:`${externalId}-fair-${index}`,url:`https://example.org/${externalId}/fair/${index}`,title:`High importance documentation ${index}`,importance:1000,evidence:{...evidenceInput,text:retainedText}}));
      fairEvents.push({...event,id:`nasa:${externalId}-fair`,source:"nasa",externalId:`${externalId}-fair`,url:`https://example.org/${externalId}/fair/nasa`,title:"Lower importance mission report",importance:1,evidence:{...evidenceInput,text:retainedText}});
      const thinMissionId=`nasa:${externalId}-thin-mission`;
      fairEvents.push({...event,id:thinMissionId,source:"nasa",externalId:`${externalId}-thin-mission`,url:`https://127.0.0.1/${externalId}/thin`,title:"Mission discovery headline",importance:2000,evidence:undefined});
      await persistSignals({...feed,events:fairEvents});
      const visitedSources:string[]=[];
      const visitedIds:string[]=[];
      const fair=await enrichBatch(2,async(answer)=>{visitedSources.push(answer.events[0].source);visitedIds.push(answer.events[0].id);return {...await synthesize(),citedEventIds:[answer.events[0].id]};},async()=>[]);
      assert.equal(fair.ready,2);assert.deepEqual(new Set(visitedSources),new Set(["github","nasa"]));
      assert.ok(visitedIds.includes(`nasa:${externalId}-fair`));assert.ok(!visitedIds.includes(thinMissionId),"Retained evidence precedes a higher-scored thin summary within its source and subject");
      await sql`delete from signal_events where id in ${sql(fairEvents.map(item=>item.id))}`;
      const olderId=`github:${externalId}-older-note`;
      const newerId=`github:${externalId}-newer-note`;
      const ageEvents:SignalEvent[]=[olderId,newerId].map((noteId,index)=>({...event,id:noteId,externalId:`${externalId}-${index}-note`,url:`https://example.org/${externalId}/age/${index}`,title:`Age queue fixture ${index}`,importance:index?1000:1,evidence:{...evidenceInput,text:retainedText}}));
      await persistSignals({...feed,events:ageEvents});
      await sql`update signal_events set first_seen_at=now()-interval '2 days' where id=${olderId}`;
      const aged=await enrichBatch(1,async(answer)=>({...await synthesize(),citedEventIds:[answer.events[0].id]}),async()=>[],false,true);
      assert.equal(aged.ready,1);
      assert.equal((await sql`select status from reading_notes where signal_id=${olderId}`)[0].status,"ready","The age lane visits an older low-importance note before a newer one");
      assert.equal((await sql`select status from reading_notes where signal_id=${newerId}`)[0].status,"pending");
      await sql`delete from signal_events where id in (${olderId},${newerId})`;
      await sql`update reading_notes set status='pending',attempts=0,retry_at=now() where signal_id=${id}`;
      const generated=await enrichBatch(1,synthesize,async()=>[]);
      assert.equal(generated.ready,1);
      assert.equal((await sql`select status from reading_notes where signal_id=${id}`)[0].status,"ready");
      await sql`update signal_events set summary=summary || ' Next revision.' where id=${id}`;
      const stale=await enrichBatch(1,async()=>{
        await sql`update signal_events set summary=summary || ' Concurrent revision.' where id=${id}`;
        return synthesize();
      },async()=>[]);
      assert.equal(stale.ready,0);
      assert.equal((await sql`select status from reading_notes where signal_id=${id}`)[0].status,"pending");
      await sql`update reading_notes set version=0,attempts=2 where signal_id=${id}`;
      const rejected=await enrichBatch(1,async()=>{throw new Error("Unsupported claim");},async()=>[]);
      assert.equal(rejected.failed,1);
      const retryState=(await sql`select status,version,attempts,retry_at>now() as delayed from reading_notes where signal_id=${id}`)[0];
      assert.equal(retryState.status,"failed");assert.equal(retryState.delayed,true);assert.equal(retryState.attempts,1);assert.equal(retryState.version,ENRICHMENT_VERSION,"A failed current worker is counted under the current enrichment version");
      assert.equal((await sql`select failure_code from reading_notes where signal_id=${id}`)[0].failure_code,"support-rejected");
      await sql`update reading_notes set retry_at=now()-interval '1 minute' where signal_id=${id}`;
      const retried=await enrichBatch(1,synthesize,async()=>[],true);
      assert.equal(retried.ready,1,"A retry lane can claim a due failed note");
      assert.equal((await sql`select failure_code from reading_notes where signal_id=${id}`)[0].failure_code,null);
      await sql`update reading_notes set status='working',attempts=3,lease_until=now()-interval '1 minute' where signal_id=${id}`;
      assert.equal((await enrichBatch(1,synthesize,async()=>[])).processed,0);
      assert.equal((await sql`select status from reading_notes where signal_id=${id}`)[0].status,"failed");
      await sql`update reading_notes set version=${ENRICHMENT_VERSION} where signal_id<>${id}`;
      await sql`update reading_notes set version=${ENRICHMENT_VERSION},status='ready',note=${sql.json(fixtureNote)} where signal_id=${id}`;
      await sql`update source_catalog set status='paused' where id='nasa'`;
      assert.equal(await enqueueMissingNotes(1),1,"An inactive cached evidence owner requeues a story that still has active observations");
      assert.equal((await sql`select status,note from reading_notes where signal_id=${id}`)[0].status,"pending");
      await sql`update source_catalog set status='active' where id='nasa'`;
      await sql`update reading_notes set version=0,status='ready',note=${sql.json(fixtureNote)} where signal_id=${id}`;
      await sql`update reading_notes set version=0,status='pending',updated_at=now()-interval '30 days' where signal_id=${unclassifiedId}`;
      const outdatedResponse=await (await readStory(new Request(`http://localhost/api/story?id=${encodeURIComponent(id)}`))).json();
      assert.equal(outdatedResponse.status,"pending");assert.equal(outdatedResponse.note,null);
      assert.equal(await enqueueMissingNotes(1),1);
      const upgraded=(await sql`select version,status,note,attempts from reading_notes where signal_id=${id}`)[0];
      assert.equal(upgraded.version,ENRICHMENT_VERSION);assert.equal(upgraded.status,"pending");assert.equal(upgraded.note,null);assert.equal(upgraded.attempts,0);
      assert.equal((await sql`select version from reading_notes where signal_id=${unclassifiedId}`)[0].version,0,"Version refresh reserves bounded work for previously available reading notes before an older unprocessed backlog");

    } finally {
      if(priorGateway===undefined) delete process.env.AI_GATEWAY_API_KEY;else process.env.AI_GATEWAY_API_KEY=priorGateway;
    }
    console.log("Postgres migrations, API table protection, signal upsert, archive-backed map and Ask, topic lookup, semantic retrieval, relationships, snapshot preservation, and canonical source evidence passed");
  } finally {
    await sql`delete from signal_events where id in (${id}, ${unclassifiedId}, ${relatedId}, ${weakParentId}, ${sharedThreadId}, ${foreignId}, ${quantumId}, ${cosmicId}, ${archiveId})`;
    await sql`delete from signal_events where id like ${`${crowdPrefix}%`}`;
    await sql`delete from signal_events where id like ${`${knowledgePrefix}%`}`;
    await sql`delete from signal_events where id like ${`${organicPrefix}%`}`;
    await sql`delete from ingestion_runs where id = ${runId}`;
    await sql`delete from ingestion_lease where run_id in (${runId}, ${competingRunId})`;
    await sql`delete from signal_snapshots where day in ('2099-01-01', '2099-01-02', '2099-01-03', '2099-01-04')`;
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
