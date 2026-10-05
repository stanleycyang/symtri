import { start } from "workflow/api";
import { enrichReadingNotes } from "@/workflows/ingest-universe";
import { availableReadingNoteLanes, claimableReadingNoteCount, enqueueMissingNotes } from "@/lib/data/enrichment";

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
  let lanes: number[];
  try {
    await enqueueMissingNotes();
    const available = await availableReadingNoteLanes(workerCount);
    const count = available.length ? await claimableReadingNoteCount(available.length) : 0;
    lanes = available.slice(0, count);
  }
  catch (error) {
    console.warn("SYMTRI reading-note enqueue unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Enrichment queue unavailable" }, { status: 503 });
  }
  if (!lanes.length) return Response.json({ status: "idle", slot, queued: 0 },
    { headers: { "Cache-Control": "no-store" } });
  const runs = await Promise.allSettled(lanes.map((lane) => start(enrichReadingNotes, [slot, lane])));
  const queued = runs.filter((run) => run.status === "fulfilled").length;
  if (queued < lanes.length) console.warn("SYMTRI enrichment dispatch incomplete", { queued, expected: lanes.length });
  return Response.json({ status: queued ? "queued" : "unavailable", slot, queued, expected: lanes.length },
    { status: queued ? 202 : 503, headers: { "Cache-Control": "no-store" } });
}
