import { getSignalFeed } from "@/lib/data/feed";
import { getArchiveCount, getKnowledgeGraph, getLatestIngestionFeedMetadata, getSemanticRelationships, getStoredFeed } from "@/lib/data/storage";
import type { SignalFeed } from "@/lib/data/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let result: SignalFeed;
  if (process.env.DATABASE_URL) {
    try {
      const archiveCount = await getArchiveCount();
      if (archiveCount) {
        const archive = await getStoredFeed();
        if (!archive?.events.length) throw new Error("No recent classified signals in archive");
        const latest = await getLatestIngestionFeedMetadata();
        const stale = !latest || Date.now() - Date.parse(latest.observedAt) > 3 * 60 * 60 * 1000;
        result = {
          ...archive, ...latest, observedAt: new Date().toISOString(), archiveCount,
          partial: stale || latest?.partial || false,
          scope: stale ? "archive" : "rolling",
        };
      } else {
        result = await getSignalFeed();
      }
    }
    catch (error) {
      console.warn("SYMTRI archive unavailable", error instanceof Error ? error.message : "unknown error");
      return Response.json({ error: "Signal archive unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  } else result = await getSignalFeed();
  if (process.env.DATABASE_URL && result.events.length) {
    try {
      const semanticRelationships = await getSemanticRelationships();
      if (Object.keys(semanticRelationships).length) result = { ...result, semanticRelationships };
    } catch (error) {
      console.warn("SYMTRI semantic relationships unavailable", error instanceof Error ? error.message : "unknown error");
    }
  }
  if (process.env.DATABASE_URL) {
    try {
      const knowledgeGraph = await getKnowledgeGraph();
      if (knowledgeGraph) result = { ...result, knowledgeGraph };
    } catch (error) {
      console.warn("SYMTRI knowledge graph unavailable", error instanceof Error ? error.message : "unknown error");
    }
  }
  return Response.json(result, {
    status: !result.events.length && Object.values(result.sources).every((status) => status === "unavailable") ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
