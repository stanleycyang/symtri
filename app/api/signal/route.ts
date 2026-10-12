import {getArchivedSignal} from "@/lib/data/storage";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
 const id = new URL(request.url).searchParams.get("id"); const headers = {"Cache-Control": "no-store"};
 if (!id || !/^[\w:.-]{1,200}$/.test(id)) return Response.json({error: "Invalid signal"}, {status:400,headers});
 if (!process.env.DATABASE_URL) return Response.json({event:null},{headers});
 try { return Response.json({event:await getArchivedSignal(id,true)},{headers}); }
 catch { return Response.json({error:"Signal unavailable"},{status:503,headers}); }
}
