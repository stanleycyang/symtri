import { start } from "workflow/api";
import { claimIngestionSlot, releaseQueuedIngestionSlot } from "@/lib/data/storage";
import { ingestUniverse } from "@/workflows/ingest-universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.DATABASE_URL) return new Response("Database is not configured", { status: 503 });

  const slot = `hour:${new Date().toISOString().slice(0, 13)}`;
  if (!await claimIngestionSlot(slot)) return Response.json({ status: "already-queued", slot });
  try {
    const run = await start(ingestUniverse, [slot]);
    return Response.json({ status: "queued", slot, runId: run.runId }, { status: 202 });
  } catch (error) {
    await releaseQueuedIngestionSlot(slot);
    console.error("SYMTRI workflow start failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Workflow start failed" }, { status: 503 });
  }
}
