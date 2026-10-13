import {publishWeeklyReport} from "@/lib/data/reports";
export const maxDuration=180;
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  const headers={"Cache-Control":"no-store"};
  const secret=process.env.CRON_SECRET;
  if(!secret || request.headers.get("authorization")!==`Bearer ${secret}`)return new Response("Unauthorized",{status:401,headers});
  if(!process.env.DATABASE_URL)return new Response("Database is not configured",{status:503,headers});
  try {return Response.json(await publishWeeklyReport(),{headers});}
  catch(error) {console.error("Weekly report publication failed",error instanceof Error ? {name:error.name,message:error.message.slice(0,240)} : {name:"UnknownError"});return Response.json({error:"Unable to publish weekly report"},{status:503,headers});}
}
