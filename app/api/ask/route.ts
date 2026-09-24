import { answerKnowledgeQuestion, answerQuestion, questionSpecificWords, questionTopics, shouldSearchKnowledge, type AskResult } from "@/lib/ai/ask";
import { embedTexts } from "@/lib/ai/embed";
import { gatewayConfigured } from "@/lib/ai/gateway";
import { canSummarize, summarizeAnswer } from "@/lib/ai/summarize";
import { getCurrentFeed } from "@/lib/data/current";
import { canonicalSignalUrl, signalContentKey } from "@/lib/data/normalize";
import { findSemanticSignals, getRecentTopicEvents, getSnapshotFeed, hasCurrentSignalEmbeddings, searchKnowledge } from "@/lib/data/storage";
import type { SignalFeed } from "@/lib/data/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function withSourceSummary(answer: AskResult, feed: SignalFeed): Promise<AskResult> {
  if (!gatewayConfigured() || !canSummarize(answer, feed)) return answer;
  try {
    const note = await summarizeAnswer(answer, feed);
    const citedOrder = new Map(note.citedEventIds.map((id, index) => [id, index]));
    return { ...answer, summary: note.summary, summaryKind: "model", citedEventIds: note.citedEventIds,
      events: answer.events.filter((event) => citedOrder.has(event.id))
        .sort((a, b) => citedOrder.get(a.id)! - citedOrder.get(b.id)!) };
  } catch (error) {
    console.warn("SYMTRI source synthesis unavailable", error instanceof Error ? error.message : "unknown error");
    return answer;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return new Response("Invalid request", { status: 400 }); }
  if (!body || typeof body !== "object") return new Response("Invalid request", { status: 400 });
  const { question, day } = body as Record<string, unknown>;
  if (typeof question !== "string" || question.trim().length < 3 || question.length > 240 || (day !== undefined && typeof day !== "string")) {
    return new Response("Invalid question", { status: 400 });
  }
  try {
    const trimmed = question.trim();
    if (!day && process.env.DATABASE_URL && shouldSearchKnowledge(trimmed)) {
      try {
        let vector: number[] | null = null;
        if (gatewayConfigured()) {
          try { [vector] = await embedTexts([trimmed]); }
          catch (error) { console.warn("SYMTRI knowledge embedding unavailable", error instanceof Error ? error.message : "unknown error"); }
        }
        const results = await searchKnowledge(trimmed, vector);
        const knowledgeFeed: SignalFeed = { observedAt: new Date().toISOString(), events: results.map((item) => item.event),
          sources: { "hacker-news": "unavailable", github: "unavailable", arxiv: "unavailable" }, partial: true, scope: "knowledge" };
        return Response.json(await withSourceSummary(answerKnowledgeQuestion(trimmed, results), knowledgeFeed), { headers: { "Cache-Control": "no-store" } });
      } catch (error) { console.warn("SYMTRI knowledge search unavailable", error instanceof Error ? error.message : "unknown error"); }
    }
    let feed = day && process.env.DATABASE_URL ? await getSnapshotFeed(day) : null;
    if (day && !feed) return new Response("Snapshot not found", { status: 404 });
    if (!feed) feed = await getCurrentFeed();
    if (!day && process.env.DATABASE_URL) {
      const references = questionTopics(trimmed);
      if (references.length) {
        try {
          const recent = await getRecentTopicEvents(references);
          const seen = new Set(feed.events.map((event) => event.id));
          const seenUrls = new Set(feed.events.map((event) => canonicalSignalUrl(event.url)));
          const seenContent = new Set(feed.events.map(signalContentKey));
          const extra = recent.filter((event) => {
            const url = canonicalSignalUrl(event.url);
            const content = signalContentKey(event);
            if (seen.has(event.id) || seenUrls.has(url) || seenContent.has(content)) return false;
            seen.add(event.id); seenUrls.add(url); seenContent.add(content);
            return true;
          });
          feed = { ...feed, events: [...feed.events, ...extra] };
        } catch (error) { console.warn("SYMTRI topic archive unavailable", error instanceof Error ? error.message : "unknown error"); }
      }
    }
    if (!feed.events.length) return new Response("Signals unavailable", { status: 503 });
    let semanticMatches: { id: string; similarity: number }[] = [];
    if (process.env.DATABASE_URL && gatewayConfigured()) {
      try {
        if (await hasCurrentSignalEmbeddings(feed.events)) {
          const [vector] = await embedTexts([trimmed]);
          semanticMatches = await findSemanticSignals(vector, feed.events);
        }
      } catch (error) {
        console.warn("SYMTRI semantic retrieval unavailable", error instanceof Error ? error.message : "unknown error");
      }
    }
    let answer = answerQuestion(trimmed, feed, semanticMatches);
    if (!day && process.env.DATABASE_URL && !answer.evidenceCount && questionSpecificWords(trimmed).length) {
      try {
        const seen = new Set(feed.events.map((event) => event.id));
        const archived = (await searchKnowledge(trimmed, null)).map(({ event }) => event).filter((event) => !seen.has(event.id));
        if (archived.length) {
          feed = { ...feed, events: [...feed.events, ...archived] };
          answer = answerQuestion(trimmed, feed, semanticMatches);
        }
      } catch (error) { console.warn("SYMTRI specific archive search unavailable", error instanceof Error ? error.message : "unknown error"); }
    }
    answer = await withSourceSummary(answer, feed);
    return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("SYMTRI ask unavailable", error instanceof Error ? error.message : "unknown error");
    return new Response("Ask Symtri unavailable", { status: 503 });
  }
}
