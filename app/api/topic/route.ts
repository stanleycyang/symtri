import { getRecentTopicEvents, getTopicPage, getTopicFeedRevision } from "@/lib/data/storage";
import { getUniverseCatalog } from "@/lib/data/catalog";
import { INITIAL_TOPIC_PAGE_SIZE, NEXT_TOPIC_PAGE_SIZE } from "@/lib/data/topic-pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const regionId = params.get("regionId");
  const childId = params.get("childId");
  const browse = params.get("browse") === "1";
  const cursor = params.get("cursor");
  const lightweight = params.get("view") === "list";
  const headers = { "Cache-Control": "no-store" };
  try {
    const catalog = await getUniverseCatalog();
    const region = catalog.topics.find((item) => item.id === regionId);
    if (!region || (childId && !region.children.some((item) => item.id === childId))) {
      return Response.json({ error: "Unknown topic" }, { status: 400, headers });
    }
    if (!process.env.DATABASE_URL) return Response.json({ events: [], nextCursor: null, ...(lightweight ? { revision: "preview" } : {}) }, { headers });
    if (browse) {
      const page = await getTopicPage(region.id, childId, cursor,
        lightweight && !cursor ? INITIAL_TOPIC_PAGE_SIZE : NEXT_TOPIC_PAGE_SIZE, true, lightweight);
      if (!lightweight) return Response.json(page, { headers: { "Cache-Control": "no-store" } });
      const revision = await getTopicFeedRevision(catalog.revision);
      const events = page.events.map(({id,source,title,url,publishedAt,topics,importance}) => ({id,source,title,url,publishedAt,topics,importance}));
      return Response.json({ events, nextCursor: page.nextCursor, revision }, { headers: { "Cache-Control": "no-store" } });
    }
    const events = await getRecentTopicEvents([{ id: region.id, childId }], false, true);
    return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid topic cursor") return Response.json({ error: error.message }, { status: 400, headers });
    console.warn("SYMTRI topic archive unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Topic archive unavailable" }, { status: 503, headers });
  }
}
