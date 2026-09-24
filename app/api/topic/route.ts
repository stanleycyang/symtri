import { getRecentTopicEvents, getTopicPage } from "@/lib/data/storage";
import { getUniverseCatalog } from "@/lib/data/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const regionId = params.get("regionId");
  const childId = params.get("childId");
  const browse = params.get("browse") === "1";
  const cursor = params.get("cursor");
  const catalog = await getUniverseCatalog();
  const region = catalog.topics.find((item) => item.id === regionId);
  if (!region || (childId && !region.children.some((item) => item.id === childId))) {
    return Response.json({ error: "Unknown topic" }, { status: 400 });
  }
  if (!process.env.DATABASE_URL) return Response.json({ events: [], nextCursor: null }, { headers: { "Cache-Control": "no-store" } });
  try {
    if (browse) return Response.json(await getTopicPage(region.id, childId, cursor), { headers: { "Cache-Control": "no-store" } });
    const events = await getRecentTopicEvents([{ id: region.id, childId }]);
    return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid topic cursor") return Response.json({ error: error.message }, { status: 400 });
    console.warn("SYMTRI topic archive unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Topic archive unavailable" }, { status: 503 });
  }
}
