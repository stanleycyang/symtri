import { readingNoteCounts } from "@/lib/data/enrichment";
import { getIngestionStatus } from "@/lib/data/storage";
import { getGrowthStatus } from "@/lib/data/catalog";
import { getLatestProductionHealth } from "@/lib/data/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ error: "Database is not configured" }, { status: 503 });
  try {
    const status = await getIngestionStatus();
    const growth = await getGrowthStatus();
    const monitor = await getLatestProductionHealth();
    const readingNotes=await readingNoteCounts();
    return Response.json({ ...status, growth, monitor, readingNotes }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("SYMTRI ingestion status unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Status unavailable" }, { status: 503 });
  }
}
