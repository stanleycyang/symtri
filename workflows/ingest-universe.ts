import { runProductionHealthCheck } from "@/lib/data/health";
import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { getStepMetadata } from "workflow";
import { embeddingStepError } from "@/lib/data/workflow-retry";
import { dispatchReadingNotes } from "@/lib/data/enrichment-dispatch";
import { getSignalFeed, selectFeedEvents } from "@/lib/data/feed";
import { embedTexts } from "@/lib/ai/embed";
import { gatewayConfigured } from "@/lib/ai/gateway";
import { rollingFeed } from "@/lib/data/rolling";
import { acquireIngestionLease, backfillSnapshotMetadata, countNewSignalsForRun, finishIngestionRun, getArchiveActivity, getArchiveChildCounts, getArchiveCount, getIngestionStatus, getPersistedCurrentFeed, getKnowledgeGraph, getArchiveRelationships, getPendingEmbeddingEvents, getStoredFeed, persistCurrentFeed, persistEmbeddings, persistSignals, persistSnapshot, rebuildKnowledgeGraph, refreshStoredClassifications, releaseIngestionLease, startIngestionRun, type IngestionResult } from "@/lib/data/storage";
import { unavailableSources, type SignalFeed } from "@/lib/data/model";
import { catalogMatches, getUniverseCatalog, getGrowthStatus, seedUniverseCatalog } from "@/lib/data/catalog";
import { discoverConcepts, retireInactiveConcepts, syncArchiveConcepts } from "@/lib/data/discovery";
import { discoverFeedCandidates, fetchActiveFeeds, pollTrialFeeds, recoverPausedFeeds } from "@/lib/data/feed-registry";
import { claimReadingNoteWorker, releaseReadingNoteWorker, renewReadingNoteWorker } from "@/lib/data/enrichment";
import { enrichOwnedBatch } from "@/lib/data/enrichment-worker";
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
  // Retain every observation and its original classification/evidence input
  // before returning a small checkpoint to the workflow's event log.
  await seedUniverseCatalog();
  await persistSignals(feed);
  return { ...feed, events: feed.events.map((event) => {
    const visible = { ...event };
    delete visible.evidence;
    return visible;
  }) };
}

async function storeFeed(slot: string, feed: SignalFeed): Promise<{ added: number; mapped: number; activity: NonNullable<SignalFeed["activity"]>; archiveCount: number; childCounts: Record<string, number> }> {
  "use step";
  // The queue is committed by database triggers before dispatch. Failure to
  // wake a worker never loses work or fails source persistence.
  try { await dispatchReadingNotes(`ingest-enrich:${slot}`,(wakeSlot,lane)=>start(enrichReadingNotes,[wakeSlot,lane])); }
  catch { console.warn("SYMTRI enrichment wake-up deferred to recovery sweep"); }
  await refreshStoredClassifications();
  await syncArchiveConcepts();
  const catalog = await getUniverseCatalog();
  const activity = await getArchiveActivity(new Date(feed.observedAt), catalog);
  const childCounts = await getArchiveChildCounts(new Date(feed.observedAt));
  const relationships = await getArchiveRelationships(new Date(feed.observedAt), catalog);
  const archiveCount = await getArchiveCount();
  const mapped = selectFeedEvents(feed.events.map((event) => ({ ...event, topics: catalogMatches(event, catalog) })), 300);
  const snapshot = rollingFeed({ ...feed, events: mapped }, await getStoredFeed(), archiveCount);
  await persistSnapshot({ ...snapshot, observedAt: feed.observedAt, sources: feed.sources, partial: feed.partial, activity, relationships, catalog });
  await persistCurrentFeed({ ...snapshot, observedAt: feed.observedAt, archiveCount, activity, childCounts,
    catalog, sources: feed.sources, partial: feed.partial });
  return { added: await countNewSignalsForRun(slot), mapped: mapped.length, activity, archiveCount, childCounts };
}

async function embedBacklog(owner?:string): Promise<{ embedded: number; embeddingStatus: string; hasMore: boolean }> {
  "use step";
  if (!gatewayConfigured()) return { embedded: 0, embeddingStatus: "not-configured", hasMore: false };
  const runId=owner ?? `embedding:${randomUUID()}`;
  const owned=owner ? await renewReadingNoteWorker(5,runId) : await claimReadingNoteWorker(5,runId);
  if(!owned) return {embedded:0,embeddingStatus:"backlog",hasMore:true};
  try {
    const pending = await getPendingEmbeddingEvents();
    let embedded: number;
    try {
      embedded = await persistEmbeddings({
        observedAt: new Date().toISOString(), events: pending, scope: "archive", partial: false,
        sources: unavailableSources(),
      }, embedTexts);
    } catch (error) { throw await embeddingStepError(error, getStepMetadata().attempt); }
    return { embedded, embeddingStatus: "ok", hasMore: (await getPendingEmbeddingEvents(1)).length > 0 };
  } finally { if(!owner) await releaseReadingNoteWorker(5,runId); }
}

async function enrichSources(lane: number, runId: string, preferRetries = false, preferOldest = false, first = false): Promise<Awaited<ReturnType<typeof enrichOwnedBatch>>> {
  "use step";
  if (first) {
    // First delivery claims once; retries must renew the existing ownership
    // rather than treating their already-started worker as a competing run.
    const retry = getStepMetadata().attempt > 1;
    const owned = retry ? await renewReadingNoteWorker(lane, runId) : await claimReadingNoteWorker(lane, runId);
    if (!owned) return { status: retry ? "lease-lost" : "busy", processed: 0, ready: 0, failed: 0 };
  }
  return enrichOwnedBatch(lane, runId, preferRetries, preferOldest);
}

async function refreshGraph():Promise<number> {
  "use step";
  return rebuildKnowledgeGraph();
}

async function claimReadingNotes(lane:number, runId:string):Promise<boolean> {
  "use step";
  return claimReadingNoteWorker(lane, runId);
}

async function releaseReadingNotes(lane:number, runId:string):Promise<void> {
  "use step";
  await releaseReadingNoteWorker(lane, runId);
}

export async function enrichReadingNotes(slot:string, lane:number) {
  "use workflow";
  const runId = `${slot}:${lane}`;
  const result={status:"complete",ready:0,failed:0,processed:0,embedded:0,embeddingStatus:"not-run"};
  let release = true;
  try {
    for(let batch=0;batch<2;batch++) {
      const next=await enrichSources(lane, runId, lane === 0 && batch === 0, lane === 3, batch === 0);
      if(next.status==="busy") { release=false; result.status="busy"; return result; }
      // Return through finally so cleanup still runs, without letting failed-note
      // or embedding status overwrite lease loss or continuing work unowned.
      result.processed+=next.processed;result.ready+=next.ready;result.failed+=next.failed;
      if(next.status==="lease-lost") { result.status="lease-lost"; return result; }
      if(next.status==="not-configured") {result.status="not-configured";break;}
      if(!next.processed) break;
    }
    if(result.failed) result.status="partial";
  } finally {if(release) await releaseReadingNotes(lane, runId);}
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
    // Reading notes were dispatched after persistence and proceed independently.
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

async function maintainArchivePhase(runId:string,phase:"discover"|"trial"|"catalog"):Promise<boolean> {
  "use step";
  if(!await renewReadingNoteWorker(4,runId)) return false;
  const now=new Date();
  if(phase==="discover") await discoverFeedCandidates(now);
  else if(phase==="trial") await pollTrialFeeds(now);
  else {
    await pruneAskRateLimits(now);
    await syncArchiveConcepts();
    await discoverConcepts(now);
    await retireInactiveConcepts(now);
    await syncArchiveConcepts();
    await backfillSnapshotMetadata();
  }
  return true;
}

async function refreshArchiveBatch(runId:string,kind:"classification"|"catalog"):Promise<number> {
  "use step";
  if(!await renewReadingNoteWorker(4,runId)) return -1;
  return kind==="classification" ? refreshStoredClassifications(1000) : syncArchiveConcepts(1000);
}

async function archiveBacklog():Promise<{classification:number;catalog:number;graph:number}> {
  "use step";
  const status=await getIngestionStatus();
  const growth=await getGrowthStatus();
  return {classification:status.classificationBacklog,catalog:growth.catalogBacklog,graph:growth.graphDirtyDays};
}

async function publishArchiveMetadata():Promise<void> {
  "use step";
  // The reader returns only a feed from the current classifier. Preserve its
  // sample, coverage and ingestion timestamp while publishing refreshed links.
  const feed=await getPersistedCurrentFeed();
  if(!feed) return;
  const catalog=await getUniverseCatalog();
  const knowledgeGraph=await getKnowledgeGraph();
  await persistCurrentFeed({...feed,catalog,knowledgeGraph:knowledgeGraph ?? undefined});
}

export async function maintainUniverse(slot:string) {
  "use workflow";
  const runId=`maintenance:${slot}`;
  if (!await claimReadingNotes(4,runId)) return {status:"busy"};
  try {
    // Bound a release backfill across durable steps, preserving snapshots and source text.
    for(let batch=0;batch<50;batch++) {
      const count=await refreshArchiveBatch(runId,"classification");
      if(count<0) return {status:"lease-lost"};
      if(count<1000) break;
    }
    if(!await maintainArchivePhase(runId,"discover")) return {status:"lease-lost"};
    if(!await maintainArchivePhase(runId,"trial")) return {status:"lease-lost"};
    if(!await maintainArchivePhase(runId,"catalog")) return {status:"lease-lost"};
    for(let batch=0;batch<50;batch++) {
      const count=await refreshArchiveBatch(runId,"catalog");
      if(count<0) return {status:"lease-lost"};
      if(count<1000) break;
    }
    for(let batch=0;batch<20;batch++) { if(await refreshGraph()<30) break; }
    const pending=await archiveBacklog();
    if(Object.values(pending).every(count=>count===0)) await publishArchiveMetadata();
    return {status:Object.values(pending).some(count=>count>0)?"backlog":"complete",...pending};
  } finally { await releaseReadingNotes(4,runId); }
}

export async function refreshEvidenceEmbeddings(slot:string) {
  "use workflow";
  const runId=`embed:${slot}`;
  if (!await claimReadingNotes(5,runId)) return {status:"busy"};
  let embedded=0;
  try {
    for(let batch=0;batch<3;batch++) {
      const next=await embedBacklog(runId);
      embedded+=next.embedded;
      if(next.embeddingStatus!=="ok" || !next.hasMore) return {...next,embedded};
    }
    return {embedded,embeddingStatus:"backlog",hasMore:true};
  } finally { await releaseReadingNotes(5,runId); }
}

// Authenticated release tooling can verify the current archive without source fetches or model calls.
async function verifyArchive():Promise<Awaited<ReturnType<typeof runProductionHealthCheck>>> {
  "use step";
  return runProductionHealthCheck();
}
export async function verifyUniverse() {
  "use workflow";
  return verifyArchive();
}
