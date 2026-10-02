import {runAskWithDeadline} from "@/lib/ai/deadline";
import { withExplorationQuestions, answerComparison, answerKnowledgeQuestion, answerQuestion, questionSpecificWords, questionTopics, shouldSearchKnowledge, type AskResult } from "@/lib/ai/ask";
import { planQuestion, type AskContext } from "@/lib/ai/intent";
import { embedTexts } from "@/lib/ai/embed";
import { gatewayConfigured } from "@/lib/ai/gateway";
import { canSummarize, summarizeAnswer } from "@/lib/ai/summarize";
import { getCurrentFeed } from "@/lib/data/current";
import { canonicalSignalUrl, signalContentKey } from "@/lib/data/normalize";
import { findSemanticSignals, getArchivedSignal, getConnectionEvents, withStoredEvidence, getSignalEvidence, getRecentTopicEvents, getSnapshotFeed, hasCurrentSignalEmbeddings, searchKnowledge } from "@/lib/data/storage";
import { unavailableSources, type SignalFeed } from "@/lib/data/model";
import { getUniverseCatalog } from "@/lib/data/catalog";
import { checkAskRateLimit } from "@/lib/data/ask-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

async function readQuestionBody(request: Request): Promise<{ value?: unknown; status?: number }> {
  if (!request.body) return { status: 400 };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4_096) { await reader.cancel(); return { status: 413 }; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { value: JSON.parse(text) };
  } catch { return { status: 400 }; }
}

async function withSourceSummary(answer: AskResult, feed: SignalFeed, context?:AskContext, deadline?:AbortSignal): Promise<AskResult> {
  if (deadline?.aborted || !gatewayConfigured() || !canSummarize(answer, feed)) return withExplorationQuestions(answer);
  try {
    const enriched = {...feed,events:[...feed.events]};
    if (process.env.DATABASE_URL && feed.scope !== "history") {
      for (const selected of answer.events.slice(0,4)) {
        const evidence=await getSignalEvidence(selected.id);
        const index=enriched.events.findIndex(event=>event.id===selected.id);
        if (index>=0 && evidence[0]) enriched.events[index]={...enriched.events[index],evidence:evidence[0].body};
      }
    }
    const note = await summarizeAnswer(answer, enriched, undefined, context, deadline);
    const citedOrder = new Map(note.citedEventIds.map((id, index) => [id, index]));
    return withExplorationQuestions({ ...answer, summary: note.summary, claims: note.claims, summaryKind: "model", citedEventIds: note.citedEventIds,
      events: answer.events.filter((event) => citedOrder.has(event.id))
        .sort((a, b) => citedOrder.get(a.id)! - citedOrder.get(b.id)!) });
  } catch (error) {
    console.warn("SYMTRI source synthesis unavailable", error instanceof Error ? error.message : "unknown error");
    return withExplorationQuestions(answer);
  }
}

async function handleAsk(request: Request, deadline:AbortSignal) {
  const parsed = await readQuestionBody(request);
  if (parsed.status) return new Response(parsed.status === 413 ? "Question too large" : "Invalid request", { status: parsed.status });
  const body = parsed.value;
  if (!body || typeof body !== "object") return new Response("Invalid request", { status: 400 });
  const { question, day, context } = body as Record<string, unknown>;
  if (typeof question !== "string" || question.trim().length < 3 || question.length > 240 || (day !== undefined && typeof day !== "string")) {
    return new Response("Invalid question", { status: 400 });
  }
  if (context !== undefined && (!context || typeof context !== "object" || Array.isArray(context)
    || Object.entries(context).some(([key, value]) => !["question", "answer", "subject", "signalId"].includes(key) || typeof value !== "string" || value.length > (key==="answer"?800:240)))) {
    return new Response("Invalid context", { status: 400 });
  }
  try {
    const retryAfter = await checkAskRateLimit(request);
    if (retryAfter !== null) return new Response("Ask limit reached", { status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } });
    const plan = planQuestion(question, context as AskContext | undefined);
    const trimmed = plan.question;
    const catalog = await getUniverseCatalog();
    if (plan.needsClarification) {
      return Response.json({ ...answerKnowledgeQuestion(question.trim(), [], catalog), needsClarification: true,
        summary: "Which subjects do you mean? Name them or select a story to continue." }, { headers: { "Cache-Control": "no-store" } });
    }
    const selectedId=(context as AskContext|undefined)?.signalId;
    if (process.env.DATABASE_URL && selectedId && /\bthis (?:source|story|paper|project)\b/i.test(question)) {
      const snapshot=day ? await getSnapshotFeed(day) : null;
      if(day && !snapshot) return new Response("Snapshot not found",{status:404});
      const event=day ? snapshot?.events.find(item=>item.id===selectedId) ?? null : await getArchivedSignal(selectedId);
      const results=event ? [{event,similarity:null}] : [];
      const selectedFeed:SignalFeed={observedAt:snapshot?.observedAt ?? new Date().toISOString(),events:event?[event]:[],sources:snapshot?.sources ?? unavailableSources(),partial:snapshot?.partial ?? false,scope:snapshot ? "history" : "knowledge"};
      const answer={...answerKnowledgeQuestion(question.trim(),results,catalog),intent:"explanation" as const,subjects:event?[event.title]:[],sourceSignalId:event?.id,scope:selectedFeed.scope,observedAt:selectedFeed.observedAt};
      return Response.json(await withSourceSummary(answer,selectedFeed,context as AskContext|undefined,deadline),{headers:{"Cache-Control":"no-store"}});
    }
    if (!day && process.env.DATABASE_URL && plan.intent !== "comparison" && shouldSearchKnowledge(trimmed, catalog)) {
      try {
        let vector: number[] | null = null;
        if (!deadline.aborted && gatewayConfigured()) {
          try { [vector] = await embedTexts([trimmed], undefined, deadline); }
          catch (error) { console.warn("SYMTRI knowledge embedding unavailable", error instanceof Error ? error.message : "unknown error"); }
        }
        const results = await searchKnowledge(trimmed, vector);
        const knowledgeFeed: SignalFeed = { observedAt: new Date().toISOString(), events: results.map((item) => item.event),
          sources: unavailableSources(), partial: true, scope: "knowledge" };
        return Response.json(await withSourceSummary(answerKnowledgeQuestion(trimmed, results, catalog), knowledgeFeed,context as AskContext|undefined,deadline), { headers: { "Cache-Control": "no-store" } });
      } catch (error) { console.warn("SYMTRI knowledge search unavailable", error instanceof Error ? error.message : "unknown error"); }
    }
    let feed = day && process.env.DATABASE_URL ? await getSnapshotFeed(day) : null;
    if (day && !feed) return new Response("Snapshot not found", { status: 404 });
    if (!feed) feed = await getCurrentFeed();
    feed = { ...feed, catalog: day ? await getUniverseCatalog(new Date(feed.observedAt)) : catalog };
    if(!day && process.env.DATABASE_URL && plan.intent==="connection") {
      const references=questionTopics(trimmed,catalog);
      if(references.length===2) {
        const children=references.flatMap(reference=>reference.childId?[{topicId:reference.id,subtopicId:reference.childId}]:[]);
        const direct=await withStoredEvidence(await getConnectionEvents(references[0].id,references[1].id,true,children));
        const events=new Map(feed.events.map(event=>[event.id,event]));
        for(const event of direct) events.set(event.id,event);
        feed={...feed,events:[...events.values()],scope:"knowledge"};
      }
    }
    if (!day && process.env.DATABASE_URL && plan.intent === "comparison") {
      const events = new Map(feed.events.map((event) => [event.id, event]));
      // Keep DB reads sequential: the shared Postgres client has one connection.
      for (const subject of plan.subjects) {
        for (const { event } of await searchKnowledge(subject, null)) events.set(event.id, event);
        const references = questionTopics(subject, catalog);
        if (references.length) for (const event of await getRecentTopicEvents(references, true)) {
          if(!events.has(event.id)) events.set(event.id,event);
        }
      }
      feed = { ...feed, events: await withStoredEvidence([...events.values()]) };
    }
    if (!day && process.env.DATABASE_URL) {
      const references = questionTopics(trimmed, feed.catalog);
      if (references.length) {
        try {
          const recent = await getRecentTopicEvents(references, true);
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
    if(!day && process.env.DATABASE_URL && plan.intent!=="comparison") {
      feed={...feed,events:await withStoredEvidence(feed.events)};
    }
    let semanticMatches: { id: string; similarity: number }[] = [];
    if (process.env.DATABASE_URL && gatewayConfigured()) {
      try {
        if (!deadline.aborted && await hasCurrentSignalEmbeddings(feed.events, !day)) {
          const [vector] = await embedTexts([trimmed], undefined, deadline);
          semanticMatches = await findSemanticSignals(vector, feed.events, !day);
        }
      } catch (error) {
        console.warn("SYMTRI semantic retrieval unavailable", error instanceof Error ? error.message : "unknown error");
      }
    }
    let answer = plan.intent === "comparison" ? answerComparison(trimmed, plan.subjects, feed, semanticMatches) : answerQuestion(trimmed, feed, semanticMatches);
    if (!day && process.env.DATABASE_URL && !answer.evidenceCount && questionSpecificWords(trimmed, feed.catalog).length) {
      try {
        const seen = new Set(feed.events.map((event) => event.id));
        const archived = (await searchKnowledge(trimmed, null)).map(({ event }) => event).filter((event) => !seen.has(event.id));
        if (archived.length) {
          feed = { ...feed, events: [...feed.events, ...archived] };
          answer = answerQuestion(trimmed, feed, semanticMatches);
        }
      } catch (error) { console.warn("SYMTRI specific archive search unavailable", error instanceof Error ? error.message : "unknown error"); }
    }
    answer = await withSourceSummary(answer, feed,context as AskContext|undefined,deadline);
    return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("SYMTRI ask unavailable", error instanceof Error ? error.message : "unknown error");
    return new Response("Ask Symtri unavailable", { status: 503 });
  }
}


export async function POST(request:Request) {
  return runAskWithDeadline(signal=>handleAsk(request,signal));
}
