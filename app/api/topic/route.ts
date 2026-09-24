import { getRecentTopicEvents } from "@/lib/data/storage";
import { topics } from "@/lib/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const regionId = params.get("regionId");
  const childId = params.get("childId");
  const region = topics.find((item) => item.id === regionId);
  if (!region || (childId && !region.children.some((item) => item.id === childId))) {
    return Response.json({ error: "Unknown topic" }, { status: 400 });
  }
  if (!process.env.DATABASE_URL) return Response.json({ events: [] }, { headers: { "Cache-Control": "no-store" } });
  try {
    const events = await getRecentTopicEvents([{ id: region.id, childId }]);
    return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("SYMTRI topic archive unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Topic archive unavailable" }, { status: 503 });
  }
}
