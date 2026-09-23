import { getSignalFeed } from "@/lib/data/feed";
import { embedTexts } from "@/lib/ai/embed";
import { persistEmbeddings, persistSignals, persistSnapshot } from "@/lib/data/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.DATABASE_URL) return new Response("Database is not configured", { status: 503 });
  try {
    const feed = await getSignalFeed();
    if (Object.values(feed.sources).every((status) => status === "unavailable")) {
      return Response.json({ error: "All sources unavailable" }, { status: 503 });
    }
    const persisted = await persistSignals(feed);
    await persistSnapshot(feed);
    let embedded = 0;
    let embeddingStatus = "not-configured";
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        embedded = await persistEmbeddings(feed, (inputs) => embedTexts(inputs, apiKey));
        embeddingStatus = "ok";
      } catch (error) {
        embeddingStatus = "unavailable";
        console.warn("SYMTRI embeddings unavailable", error instanceof Error ? error.message : "unknown error");
      }
    }
    return Response.json({ observedAt: feed.observedAt, persisted, embedded, embeddingStatus, sources: feed.sources });
  } catch (error) {
    console.error("SYMTRI ingest failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Ingestion failed" }, { status: 500 });
  }
}
