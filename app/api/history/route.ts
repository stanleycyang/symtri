import { getSnapshotDays, getSnapshotFeed } from "@/lib/data/storage";
import { getUniverseCatalog } from "@/lib/data/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ days: [] }, { headers: { "Cache-Control": "no-store" } });
  try {
    const day = new URL(request.url).searchParams.get("day");
    if (day !== null) {
      const feed = await getSnapshotFeed(day);
      return feed ? Response.json({ ...feed, catalog: feed.catalog ?? await getUniverseCatalog(new Date(feed.observedAt)) }, { headers: { "Cache-Control": "no-store" } }) : new Response("Snapshot not found", { status: 404 });
    }
    return Response.json({ days: await getSnapshotDays() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("SYMTRI history unavailable", error instanceof Error ? error.message : "unknown error");
    return new Response("History unavailable", { status: 503 });
  }
}
