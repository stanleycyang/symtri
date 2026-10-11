import { start } from "workflow/api";
import { refreshEvidenceEmbeddings } from "@/workflows/ingest-universe";
import { availableReadingNoteLanes } from "@/lib/data/enrichment";
import { getPendingEmbeddingEvents } from "@/lib/data/storage";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:Request) {
  const secret=process.env.CRON_SECRET;
  if(!secret || request.headers.get("authorization")!==`Bearer ${secret}`) return new Response("Unauthorized",{status:401});
  if(!process.env.DATABASE_URL) return new Response("Database is not configured",{status:503});
  try {
    if(!(await availableReadingNoteLanes(6)).includes(5) || !(await getPendingEmbeddingEvents(1)).length) return Response.json({status:"idle"},{headers:{"Cache-Control":"no-store"}});
    const slot=`embed:${new Date().toISOString().slice(0,16)}`;
    const run=await start(refreshEvidenceEmbeddings,[slot]);
    return Response.json({status:"queued",runId:run.runId},{status:202,headers:{"Cache-Control":"no-store"}});
  } catch { return Response.json({error:"Unable to queue embed"},{status:503}); }
}
