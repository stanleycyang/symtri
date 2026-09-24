import { getCurrentFeed } from "@/lib/data/current";
import { getKnowledgeGraph, getSemanticRelationships } from "@/lib/data/storage";
import type { SignalFeed } from "@/lib/data/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let result: SignalFeed;
  try { result = await getCurrentFeed(); }
  catch (error) {
    console.warn("SYMTRI archive unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Signal archive unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
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
      if (knowledgeGraph) result = { ...result, knowledgeGraph,
        ...(knowledgeGraph.recentRelationships ? { relationships: knowledgeGraph.recentRelationships } : {}) };
    } catch (error) {
      console.warn("SYMTRI knowledge graph unavailable", error instanceof Error ? error.message : "unknown error");
    }
  }
  return Response.json(result, {
    status: !result.events.length && Object.values(result.sources).every((status) => status === "unavailable") ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
