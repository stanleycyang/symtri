import { getSignalFeed, selectFeedEvents } from "@/lib/data/feed";
import { embedTexts } from "@/lib/ai/embed";
import { gatewayConfigured } from "@/lib/ai/gateway";
import { rollingFeed } from "@/lib/data/rolling";
import { acquireIngestionLease, backfillSnapshotMetadata, countNewSignalsForRun, finishIngestionRun, getArchiveActivity, getArchiveChildCounts, getArchiveCount, getArchiveRelationships, getPendingEmbeddingEvents, getStoredFeed, persistCurrentFeed, persistEmbeddings, persistSignals, persistSnapshot, rebuildKnowledgeGraph, refreshStoredClassifications, releaseIngestionLease, startIngestionRun, type IngestionResult } from "@/lib/data/storage";
import { unavailableSources, type SignalFeed } from "@/lib/data/model";
import { catalogMatches, getUniverseCatalog, seedUniverseCatalog } from "@/lib/data/catalog";
import { discoverConcepts, retireInactiveConcepts, syncArchiveConcepts } from "@/lib/data/discovery";
import { discoverFeedCandidates, fetchActiveFeeds, pollTrialFeeds } from "@/lib/data/feed-registry";

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
  feed.partial ||= Object.values(registered.sources).some((status) => status !== "ok");
  if (Object.values(feed.sources).every((status) => status === "unavailable")) {
    throw new Error("All sources unavailable");
  }
  return feed;
}

async function storeFeed(slot: string, feed: SignalFeed): Promise<{ added: number; mapped: number; activity: NonNullable<SignalFeed["activity"]>; archiveCount: number; childCounts: Record<string, number> }> {
  "use step";
  await seedUniverseCatalog();
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
  await rebuildKnowledgeGraph(relationships);
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
