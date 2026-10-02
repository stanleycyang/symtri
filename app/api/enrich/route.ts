import { start } from "workflow/api";
import { enrichReadingNotes } from "@/workflows/ingest-universe";
import { enqueueMissingNotes } from "@/lib/data/enrichment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workerCount = 4;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.DATABASE_URL) return new Response("Database is not configured", { status: 503 });

  const slot = `enrich:${new Date().toISOString().slice(0, 16)}`;
  try { await enqueueMissingNotes(); }
  catch (error) {
    console.warn("SYMTRI reading-note enqueue unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Enrichment queue unavailable" }, { status: 503 });
  }
  const runs = await Promise.allSettled(Array.from({ length: workerCount }, (_, lane) =>
    start(enrichReadingNotes, [slot, lane])));
  const queued = runs.filter((run) => run.status === "fulfilled").length;
  if (queued < workerCount) console.warn("SYMTRI enrichment dispatch incomplete", { queued, expected: workerCount });
  return Response.json({ status: queued ? "queued" : "unavailable", slot, queued, expected: workerCount },
    { status: queued ? 202 : 503, headers: { "Cache-Control": "no-store" } });
}
