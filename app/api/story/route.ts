import { getReadingNote } from "@/lib/data/enrichment";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  const id=new URL(request.url).searchParams.get("id");
  if (!id || id.length>200 || !/^[\w:.-]+$/.test(id)) return Response.json({error:"Invalid story"},{status:400});
  const headers={"Cache-Control":"no-store"};
  if (!process.env.DATABASE_URL) return Response.json({status:"unavailable",note:null},{headers});
  try { return Response.json(await getReadingNote(id) ?? {status:"pending",note:null},{headers}); }
  catch { return Response.json({error:"Reading note unavailable"},{status:503,headers}); }
}
