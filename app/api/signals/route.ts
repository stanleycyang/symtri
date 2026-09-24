import { getSignalFeed } from "@/lib/data/feed";
import { getArchiveCount, getSemanticRelationships, getStoredFeed } from "@/lib/data/storage";
import { rollingFeed } from "@/lib/data/rolling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const feed = await getSignalFeed();
  const unavailable = Object.values(feed.sources).every((status) => status === "unavailable");
  let result = feed;
  if (process.env.DATABASE_URL) {
    try {
      const [archive, archiveCount] = await Promise.all([getStoredFeed(), getArchiveCount()]);
      result = rollingFeed(feed, archive, archiveCount);
    }
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
