import { start } from "workflow/api";
import { enrichReadingNotes } from "@/workflows/ingest-universe";
import { enqueueMissingNotes } from "@/lib/data/enrichment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { dispatchReadingNotes } from "@/lib/data/enrichment-dispatch";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.DATABASE_URL) return new Response("Database is not configured", { status: 503 });

  const slot = `enrich:${new Date().toISOString().slice(0, 16)}`;
  try {
    await enqueueMissingNotes();
    const result=await dispatchReadingNotes(slot,(slot,lane)=>start(enrichReadingNotes,[slot,lane]));
    return Response.json(result,{status:result.queued?202:result.status==="unavailable"?503:200,
      headers:{"Cache-Control":"no-store"}});
  } catch {
    return Response.json({error:"Enrichment queue unavailable"},{status:503});
  }
}
