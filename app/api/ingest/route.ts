import { randomUUID } from "node:crypto";
import { getSignalFeed } from "@/lib/data/feed";
import { selectFeedEvents } from "@/lib/data/feed";
import { embedTexts } from "@/lib/ai/embed";
import { gatewayConfigured } from "@/lib/ai/gateway";
import { acquireIngestionLease, finishIngestionRun, getArchiveCount, getPendingEmbeddingEvents, persistEmbeddings, persistSignals, persistSnapshot, rebuildKnowledgeGraph, releaseIngestionLease, startIngestionRun, type IngestionResult } from "@/lib/data/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.DATABASE_URL) return new Response("Database is not configured", { status: 503 });
  const runId = randomUUID();
  if (!await acquireIngestionLease(runId)) return Response.json({ status: "already-running" }, { status: 409 });
  let result: IngestionResult = { status: "failed" };
  try {
    await startIngestionRun(runId);
    const feed = await getSignalFeed({ includeUnclassified: true });
    if (Object.values(feed.sources).every((status) => status === "unavailable")) {
      result = { status: "failed", sources: feed.sources, error: "All sources unavailable" };
      return Response.json({ error: "All sources unavailable" }, { status: 503 });
    }
    const mapped = selectFeedEvents(feed.events);
    const before = await getArchiveCount();
    await persistSignals(feed);
    const added = await getArchiveCount() - before;
    await persistSnapshot({ ...feed, events: mapped });
    await rebuildKnowledgeGraph();
    let embedded = 0;
    let embeddingStatus = "not-configured";
    if (gatewayConfigured()) {
      try {
        const pending = await getPendingEmbeddingEvents();
        embedded = await persistEmbeddings({ ...feed, events: pending }, embedTexts);
        embeddingStatus = "ok";
      } catch (error) {
        embeddingStatus = "unavailable";
        console.warn("SYMTRI embeddings unavailable", error instanceof Error ? error.message : "unknown error");
      }
    }
    result = { status: feed.partial || embeddingStatus !== "ok" ? "partial" : "complete", sources: feed.sources,
      fetched: feed.events.length, mapped: mapped.length, added, embedded, embeddingStatus };
    return Response.json({ observedAt: feed.observedAt, ...result });
  } catch (error) {
    console.error("SYMTRI ingest failed", error instanceof Error ? error.message : "unknown error");
    result = { status: "failed", error: error instanceof Error ? error.message.slice(0, 200) : "unknown error" };
    return Response.json({ error: "Ingestion failed" }, { status: 500 });
  } finally {
    try { await finishIngestionRun(runId, result); }
    catch (error) { console.error("SYMTRI ingestion status unavailable", error instanceof Error ? error.message : "unknown error"); }
    try { await releaseIngestionLease(runId); }
    catch (error) { console.error("SYMTRI ingestion lease release failed", error instanceof Error ? error.message : "unknown error"); }
  }
}
