import { getUniverseCatalog } from "@/lib/data/catalog";
import { getConnectionEvents } from "@/lib/data/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const first = params.get("from");
  const second = params.get("to");
  try {
    const catalog = await getUniverseCatalog();
    if (!first || !second || first === second || ![first, second].every((id) => catalog.topics.some((topic) => topic.id === id))) {
      return Response.json({ error: "Unknown connection" }, { status: 400 });
    }
    const events = process.env.DATABASE_URL ? await getConnectionEvents(first, second, params.get("archive") === "1") : [];
    return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Connection sources unavailable" }, { status: 503 });
  }
}
