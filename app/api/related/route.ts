import { getRelatedSignals } from "@/lib/data/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || id.length > 180 || !/^(hacker-news|github|arxiv|openalex):[^\s]+$/.test(id)) {
    return Response.json({ error: "Invalid signal" }, { status: 400 });
  }
  if (!process.env.DATABASE_URL) return Response.json({ signals: [] }, { headers: { "Cache-Control": "no-store" } });
  try {
    return Response.json({ signals: await getRelatedSignals(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("SYMTRI related signals unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Related signals unavailable" }, { status: 503 });
  }
}
