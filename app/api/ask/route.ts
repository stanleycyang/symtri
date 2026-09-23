import { answerQuestion } from "@/lib/ai/ask";
import { embedTexts } from "@/lib/ai/embed";
import { canSummarize, summarizeAnswer } from "@/lib/ai/summarize";
import { getSignalFeed } from "@/lib/data/feed";
import { findSemanticSignals, getSnapshotFeed, getStoredFeed, hasCurrentSignalEmbeddings } from "@/lib/data/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return new Response("Invalid request", { status: 400 }); }
  if (!body || typeof body !== "object") return new Response("Invalid request", { status: 400 });
  const { question, day } = body as Record<string, unknown>;
  if (typeof question !== "string" || question.trim().length < 3 || question.length > 240 || (day !== undefined && typeof day !== "string")) {
    return new Response("Invalid question", { status: 400 });
  }
  try {
    let feed = day && process.env.DATABASE_URL ? await getSnapshotFeed(day) : null;
    if (day && !feed) return new Response("Snapshot not found", { status: 404 });
    if (!feed) {
      feed = await getSignalFeed();
      if (!feed.events.length && process.env.DATABASE_URL) feed = await getStoredFeed() ?? feed;
    }
    if (!feed.events.length) return new Response("Signals unavailable", { status: 503 });
    const trimmed = question.trim();
    let semanticMatches: { id: string; similarity: number }[] = [];
    if (process.env.DATABASE_URL && process.env.OPENAI_API_KEY) {
      try {
        if (await hasCurrentSignalEmbeddings(feed.events)) {
          const [vector] = await embedTexts([trimmed], process.env.OPENAI_API_KEY);
          semanticMatches = await findSemanticSignals(vector, feed.events);
        }
      } catch (error) {
        console.warn("SYMTRI semantic retrieval unavailable", error instanceof Error ? error.message : "unknown error");
      }
    }
    let answer = answerQuestion(trimmed, feed, semanticMatches);
    if (process.env.OPENAI_API_KEY && canSummarize(answer, feed)) {
      try {
        const note = await summarizeAnswer(answer, feed, process.env.OPENAI_API_KEY);
        const citedOrder = new Map(note.citedEventIds.map((id, index) => [id, index]));
        answer = { ...answer, summary: note.summary, summaryKind: "model", citedEventIds: note.citedEventIds,
          events: [...answer.events].sort((a, b) => (citedOrder.get(a.id) ?? 99) - (citedOrder.get(b.id) ?? 99)) };
      } catch (error) {
        console.warn("SYMTRI source synthesis unavailable", error instanceof Error ? error.message : "unknown error");
      }
    }
    return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("SYMTRI ask unavailable", error instanceof Error ? error.message : "unknown error");
    return new Response("Ask Symtri unavailable", { status: 503 });
  }
}
