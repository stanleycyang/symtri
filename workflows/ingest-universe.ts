import { getSignalFeed, selectFeedEvents } from "@/lib/data/feed";
import { embedTexts } from "@/lib/ai/embed";
import { gatewayConfigured } from "@/lib/ai/gateway";
import { rollingFeed } from "@/lib/data/rolling";
import { acquireIngestionLease, countNewSignalsForRun, finishIngestionRun, getPendingEmbeddingEvents, getStoredFeed, persistEmbeddings, persistSignals, persistSnapshot, rebuildKnowledgeGraph, refreshStoredClassifications, releaseIngestionLease, startIngestionRun, type IngestionResult } from "@/lib/data/storage";
import type { SignalFeed } from "@/lib/data/model";

async function begin(slot: string): Promise<boolean> {
  "use step";
  if (!await acquireIngestionLease(slot)) return false;
  try { await startIngestionRun(slot); }
  catch (error) { await releaseIngestionLease(slot); throw error; }
  return true;
}

async function fetchSources(): Promise<SignalFeed> {
  "use step";
  const feed = await getSignalFeed({ includeUnclassified: true, forIngestion: true });
  if (Object.values(feed.sources).every((status) => status === "unavailable")) {
    throw new Error("All sources unavailable");
  }
  return feed;
}

async function storeFeed(slot: string, feed: SignalFeed): Promise<{ added: number; mapped: number }> {
  "use step";
  await persistSignals(feed);
  await refreshStoredClassifications();
  const mapped = selectFeedEvents(feed.events, 300);
  const snapshot = rollingFeed({ ...feed, events: mapped }, await getStoredFeed(), 0);
  await persistSnapshot({ ...snapshot, observedAt: feed.observedAt, sources: feed.sources, partial: feed.partial });
  await rebuildKnowledgeGraph();
  return { added: await countNewSignalsForRun(slot), mapped: mapped.length };
}

async function embedBacklog(): Promise<{ embedded: number; embeddingStatus: string }> {
  "use step";
  if (!gatewayConfigured()) return { embedded: 0, embeddingStatus: "not-configured" };
  const pending = await getPendingEmbeddingEvents();
  const embedded = await persistEmbeddings({
    observedAt: new Date().toISOString(), events: pending, scope: "archive", partial: false,
    sources: { "hacker-news": "unavailable", github: "unavailable", arxiv: "unavailable" },
  }, embedTexts);
  return { embedded, embeddingStatus: "ok" };
}

async function finish(slot: string, result: IngestionResult): Promise<void> {
  "use step";
  try { await finishIngestionRun(slot, result); }
  finally { await releaseIngestionLease(slot); }
}

export async function ingestUniverse(slot: string): Promise<IngestionResult> {
  "use workflow";
  if (!await begin(slot)) return { status: "partial", error: "Another ingestion is running" };
  let result: IngestionResult = { status: "failed" };
  try {
    const feed = await fetchSources();
    const stored = await storeFeed(slot, feed);
    let embedding = { embedded: 0, embeddingStatus: "unavailable" };
    try { embedding = await embedBacklog(); }
    catch (error) { console.warn("SYMTRI embeddings unavailable", error instanceof Error ? error.message : "unknown error"); }
    result = {
      status: feed.partial || embedding.embeddingStatus !== "ok" ? "partial" : "complete",
      sources: feed.sources, fetched: feed.events.length, mapped: stored.mapped,
      added: stored.added, ...embedding,
    };
  } catch (error) {
    result = { status: "failed", error: error instanceof Error ? error.message.slice(0, 200) : "unknown error" };
    console.error("SYMTRI ingestion failed", result.error);
  }
  await finish(slot, result);
  return result;
}
