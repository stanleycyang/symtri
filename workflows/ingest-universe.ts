import { getSignalFeed, selectFeedEvents } from "@/lib/data/feed";
import { embedTexts } from "@/lib/ai/embed";
import { gatewayConfigured } from "@/lib/ai/gateway";
import { rollingFeed } from "@/lib/data/rolling";
import { acquireIngestionLease, backfillSnapshotMetadata, countNewSignalsForRun, finishIngestionRun, getArchiveActivity, getArchiveChildCounts, getArchiveCount, getArchiveRelationships, getPendingEmbeddingEvents, getStoredFeed, persistCurrentFeed, persistEmbeddings, persistSignals, persistSnapshot, rebuildKnowledgeGraph, refreshStoredClassifications, releaseIngestionLease, startIngestionRun, type IngestionResult } from "@/lib/data/storage";
import { unavailableSources, type SignalFeed } from "@/lib/data/model";
import { catalogMatches, getUniverseCatalog, seedUniverseCatalog } from "@/lib/data/catalog";
import { discoverConcepts, retireInactiveConcepts, syncArchiveConcepts } from "@/lib/data/discovery";
import { discoverFeedCandidates, fetchActiveFeeds, pollTrialFeeds, recoverPausedFeeds } from "@/lib/data/feed-registry";
import { claimReadingNoteWorker, enrichBatch, releaseReadingNoteWorker, renewReadingNoteWorker } from "@/lib/data/enrichment";
import { pruneAskRateLimits } from "@/lib/data/ask-limit";

async function begin(slot: string): Promise<boolean> {
  "use step";
  if (!await acquireIngestionLease(slot)) return false;
  try {
    if (!await startIngestionRun(slot)) {
      await releaseIngestionLease(slot);
      return false;
    }
  }
  catch (error) { await releaseIngestionLease(slot); throw error; }
  return true;
}

async function fetchSources(slot: string): Promise<SignalFeed> {
  "use step";
  const feed = await getSignalFeed({ includeUnclassified: true, forIngestion: true, slot });
  const registered = await fetchActiveFeeds(new Date(feed.observedAt));
  feed.events.push(...registered.events);
  Object.assign(feed.sources, registered.sources);
  const recovered = await recoverPausedFeeds(new Date(feed.observedAt));
  feed.events.push(...recovered.events);
  Object.assign(feed.sources, recovered.sources);
  feed.partial ||= [...Object.values(registered.sources), ...Object.values(recovered.sources)].some((status) => status !== "ok");
  if (Object.values(feed.sources).every((status) => status === "unavailable")) {
    throw new Error("All sources unavailable");
  }
  return feed;
}

async function storeFeed(slot: string, feed: SignalFeed): Promise<{ added: number; mapped: number; activity: NonNullable<SignalFeed["activity"]>; archiveCount: number; childCounts: Record<string, number> }> {
  "use step";
  await seedUniverseCatalog();
  await pruneAskRateLimits(new Date(feed.observedAt));
  await persistSignals(feed);
  await refreshStoredClassifications();
  await discoverFeedCandidates(new Date(feed.observedAt));
  await pollTrialFeeds(new Date(feed.observedAt));
  await syncArchiveConcepts();
  await discoverConcepts(new Date(feed.observedAt));
  await retireInactiveConcepts(new Date(feed.observedAt));
  await syncArchiveConcepts();
  const catalog = await getUniverseCatalog();
  const activity = await getArchiveActivity(new Date(feed.observedAt), catalog);
  const childCounts = await getArchiveChildCounts(new Date(feed.observedAt));
  const relationships = await getArchiveRelationships(new Date(feed.observedAt), catalog);
  const archiveCount = await getArchiveCount();
  const mapped = selectFeedEvents(feed.events.map((event) => ({ ...event, topics: catalogMatches(event, catalog) })), 300);
  const snapshot = rollingFeed({ ...feed, events: mapped }, await getStoredFeed(), archiveCount);
  await persistSnapshot({ ...snapshot, observedAt: feed.observedAt, sources: feed.sources, partial: feed.partial, activity, relationships, catalog });
  await backfillSnapshotMetadata();
  await persistCurrentFeed({ ...snapshot, observedAt: feed.observedAt, archiveCount, activity, childCounts,
    catalog, sources: feed.sources, partial: feed.partial });
  return { added: await countNewSignalsForRun(slot), mapped: mapped.length, activity, archiveCount, childCounts };
}

async function embedBacklog(): Promise<{ embedded: number; embeddingStatus: string; hasMore: boolean }> {
  "use step";
  if (!gatewayConfigured()) return { embedded: 0, embeddingStatus: "not-configured", hasMore: false };
  const pending = await getPendingEmbeddingEvents();
  const embedded = await persistEmbeddings({
    observedAt: new Date().toISOString(), events: pending, scope: "archive", partial: false,
    sources: unavailableSources(),
  }, embedTexts);
  return { embedded, embeddingStatus: "ok", hasMore: (await getPendingEmbeddingEvents(1)).length > 0 };
}

async function enrichSources(preferRetries = false, preferOldest = false): Promise<Awaited<ReturnType<typeof enrichBatch>>> {
  "use step";
  return enrichBatch(2, undefined, undefined, preferRetries, preferOldest);
}

async function refreshGraph():Promise<number> {
  "use step";
  return rebuildKnowledgeGraph();
}

async function claimReadingNotes(lane:number, runId:string):Promise<boolean> {
  "use step";
  return claimReadingNoteWorker(lane, runId);
}

async function renewReadingNotes(lane:number, runId:string):Promise<boolean> {
  "use step";
  return renewReadingNoteWorker(lane, runId);
}

async function releaseReadingNotes(lane:number, runId:string):Promise<void> {
  "use step";
  await releaseReadingNoteWorker(lane, runId);
}

export async function enrichReadingNotes(slot:string, lane:number) {
  "use workflow";
  const runId = `${slot}:${lane}`;
  if (!await claimReadingNotes(lane, runId)) return {status:"busy",ready:0,failed:0,processed:0,embedded:0,embeddingStatus:"not-run"};
  const result={status:"complete",ready:0,failed:0,processed:0,embedded:0,embeddingStatus:"not-run"};
  try {
    for(let batch=0;batch<5;batch++) {
      if (!await renewReadingNotes(lane, runId)) { result.status="lease-lost"; break; }
      const next=await enrichSources(lane === 0 && batch < 3, lane === 3);
      result.processed+=next.processed;result.ready+=next.ready;result.failed+=next.failed;
      if(next.status==="not-configured") {result.status="not-configured";break;}
      if(!next.processed) break;
    }
    if(result.failed) result.status="partial";
    // Hydrating a source invalidates its previous vector. Keep this pass bounded;
    // the next scheduled run picks up anything changed after this lane finishes.
    if (lane === 1) {
      try {
        for (let batch=0;batch<3;batch++) {
          const embedding = await embedBacklog();
          result.embedded += embedding.embedded;
          result.embeddingStatus = embedding.hasMore ? "backlog" : embedding.embeddingStatus;
          if (embedding.embeddingStatus !== "ok" || !embedding.hasMore) break;
        }
        if (result.embeddingStatus !== "ok") result.status = "partial";
      } catch (error) {
        result.embeddingStatus = "unavailable";
        result.status = "partial";
        console.warn("SYMTRI reading-note embeddings unavailable",error instanceof Error ? error.message : "unknown error");
      }
    }
  } finally {await releaseReadingNotes(lane, runId);}
  return result;
}

async function finish(slot: string, result: IngestionResult): Promise<void> {
  "use step";
  try { await finishIngestionRun(slot, result); }
  finally { await releaseIngestionLease(slot); }
}

export async function ingestUniverse(slot: string): Promise<IngestionResult> {
  "use workflow";
  if (!await begin(slot)) return { status: "partial", error: "Ingestion slot already used or another run is active" };
  let result: IngestionResult = { status: "failed" };
  try {
    const feed = await fetchSources(slot);
    const stored = await storeFeed(slot, feed);
    // Each step rebuilds at most 30 days. Backfills can dirty more than one batch.
    for(let batch=0;batch<3;batch++) {
      if(await refreshGraph()<30) break;
    }
    // Reading notes run on their own schedule so source ingestion remains bounded.
    const embedding = { embedded: 0, embeddingStatus: "unavailable" };
    try {
      for (let batch = 0; batch < 3; batch++) {
        const next = await embedBacklog();
        embedding.embedded += next.embedded;
        embedding.embeddingStatus = next.embeddingStatus;
        if (next.embeddingStatus !== "ok" || !next.hasMore) break;
        if (batch === 2) embedding.embeddingStatus = "backlog";
      }
    }
    catch (error) {
      embedding.embeddingStatus = "unavailable";
      console.warn("SYMTRI embeddings unavailable", error instanceof Error ? error.message : "unknown error");
    }
    result = {
      status: feed.partial || embedding.embeddingStatus !== "ok" ? "partial" : "complete",
      sources: feed.sources, fetched: feed.events.length, mapped: stored.mapped,
      added: stored.added, activity: stored.activity, archiveCount: stored.archiveCount,
      childCounts: stored.childCounts, ...embedding,
    };
  } catch (error) {
    result = { status: "failed", error: error instanceof Error ? error.message.slice(0, 200) : "unknown error" };
    console.error("SYMTRI ingestion failed", result.error);
  }
  await finish(slot, result);
  return result;
}
