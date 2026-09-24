import { getIngestionStatus } from "@/lib/data/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ error: "Database is not configured" }, { status: 503 });
  try {
    return Response.json(await getIngestionStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("SYMTRI ingestion status unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Status unavailable" }, { status: 503 });
  }
}
