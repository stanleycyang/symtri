import { runProductionHealthCheck } from "@/lib/data/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.DATABASE_URL) return new Response("Database is not configured", { status: 503 });
  try {
    const result = await runProductionHealthCheck();
    return Response.json(result, { status: result.status === "healthy" ? 200 : 503,
      headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("SYMTRI production verification failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Production verification failed" }, { status: 503 });
  }
}
