import { getSignalFeed } from "@/lib/data/feed";
import { getSemanticRelationships, getStoredFeed } from "@/lib/data/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const feed = await getSignalFeed();
  const unavailable = Object.values(feed.sources).every((status) => status === "unavailable");
  let result = feed;
  if (unavailable && process.env.DATABASE_URL) {
    try { result = await getStoredFeed() ?? feed; }
    catch (error) { console.warn("SYMTRI archive unavailable", error instanceof Error ? error.message : "unknown error"); }
  }
  if (process.env.DATABASE_URL && result.events.length) {
    try {
      const semanticRelationships = await getSemanticRelationships();
      if (Object.keys(semanticRelationships).length) result = { ...result, semanticRelationships };
    } catch (error) {
      console.warn("SYMTRI semantic relationships unavailable", error instanceof Error ? error.message : "unknown error");
    }
  }
  return Response.json(result, {
    status: unavailable && result === feed ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
