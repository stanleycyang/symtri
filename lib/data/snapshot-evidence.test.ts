import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { sourceCheckpoint } from "./ingestion-checkpoint";
import { evidenceFingerprint } from "./enrichment-policy";
import { rollingFeed } from "./rolling";
import type { SignalEvent, SignalFeed } from "./model";

function loadFunction<T>(path: string, name: string, dependencies: Record<string, unknown>, env = {}, setup = "") {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const testModule = { exports: {} as { subject: T } };
  runInNewContext(`${compiled}\n${setup}\nmodule.exports.subject = ${name};`, {
    module: testModule, exports: testModule.exports, console, Response, Request, AbortSignal, TextDecoder,
    process: { env },
    require: (name: string) => dependencies[name] ?? {},
  });
  return testModule.exports.subject;
}

const observedAt = "2026-10-23T12:00:00Z";
function event(id: string): SignalEvent {
  return {
    id, source: "github", externalId: id, title: `Source ${id}`, url: `https://example.com/${id}`,
    summary: "Short display summary", publishedAt: "2026-10-23T11:00:00Z", importance: .5,
    topics: [{ topicId: "technology", subtopicId: null, relevance: 1 }],
  };
}
const evidence = (id: string) => ({ text: `Capture-time source passage for ${id}`, kind: "repository" as const,
  url: `https://example.com/${id}`, attribution: "Example", license: null, retrievedAt: observedAt });

// Execute the real workflow step and Ask handler with in-memory persistence and
// provider doubles. No application, database, storage or model endpoint is used.
test("source-stripped checkpoints capture evidence for both fresh and rolling snapshot events", async () => {
  const feed = sourceCheckpoint({ observedAt, scope: "sample", partial: false, sources: { github: "ok" },
    events: [{ ...event("fresh"), evidence: evidence("fresh") }] });
  const archived: SignalFeed = { ...feed, events: [event("older")] };
  let saved: SignalFeed | undefined;
  let current: SignalFeed | undefined;
  let hydratedIds: string[] = [];
  const storeFeed = loadFunction<(slot: string, feed: SignalFeed) => Promise<unknown>>(
    "../../workflows/ingest-universe.ts", "storeFeed", {
      "@/lib/data/enrichment-dispatch": { dispatchReadingNotes: async () => {} },
      "@/lib/data/feed": { selectFeedEvents: (events: SignalEvent[]) => events },
      "@/lib/data/rolling": { rollingFeed },
      "@/lib/data/catalog": { getUniverseCatalog: async () => ({}), catalogMatches: (event: SignalEvent) => event.topics },
      "@/lib/data/discovery": { syncArchiveConcepts: async () => {} },
      "@/lib/data/storage": {
        refreshStoredClassifications: async () => {}, getArchiveActivity: async () => ({}),
        getArchiveChildCounts: async () => ({}), getArchiveRelationships: async () => ({}),
        getArchiveCount: async () => 2, getStoredFeed: async () => archived,
        withSnapshotEvidence: async (events: SignalEvent[], checkpoint: ReturnType<typeof sourceCheckpoint>) => {
          assert.equal(checkpoint.evidenceRefs?.fresh.contentHash, feed.evidenceRefs?.fresh.contentHash);
          assert.ok(checkpoint.evidenceRefs?.fresh.contentHash);
          hydratedIds = events.map(event => event.id);
          return events.map(event => ({ ...event, evidence: evidence(event.id) }));
        },
        persistSnapshot: async (snapshot: SignalFeed) => { saved = JSON.parse(JSON.stringify(snapshot)); },
        persistCurrentFeed: async (feed: SignalFeed) => { current = feed; }, countNewSignalsForRun: async () => 1,
      },
    });
  await storeFeed("slot", feed);
  assert.deepEqual(hydratedIds.sort(), ["fresh", "older"]);
  assert.ok(saved);
  assert.ok(current);
  assert.equal(Object.hasOwn(saved, "evidenceRefs"), false, "Historical feeds omit private checkpoint references");
  assert.equal(Object.hasOwn(current, "evidenceRefs"), false, "Public current feeds omit private checkpoint references");
  assert.ok(current.events.every(event => !event.evidence), "Current feed remains lean");
  assert.equal(saved.events.length, 2);
  assert.ok(saved.events.every(event => event.evidence?.text === evidence(event.id).text));
  assert.ok(feed.events.every(event => !event.evidence), "Workflow checkpoint remains small and unmodified");

  const snapshot: SignalFeed = { ...saved, scope: "history" };
  let summarized: SignalFeed | undefined;
  let currentEvidenceReads = 0;
  const forbiddenCurrentRead = async () => { currentEvidenceReads++; throw new Error("Must not read later evidence for history"); };
  const handleAsk = loadFunction<(request: Request, signal: AbortSignal) => Promise<Response>>(
    "../../app/api/ask/route.ts", "handleAsk", {
      "@/lib/ai/intent": { planQuestion: (question: string) => ({ question, intent: "overview" }) },
      "@/lib/ai/gateway": { gatewayConfigured: () => true },
      "@/lib/ai/ask": {
        answerQuestion: (_question: string, feed: SignalFeed) => ({ events: feed.events, evidenceCount: feed.events.length }),
        withExplorationQuestions: (answer: unknown) => answer,
      },
      "@/lib/ai/summarize": {
        canSummarize: () => true,
        summarizeAnswer: async (_answer: unknown, feed: SignalFeed) => {
          summarized = feed;
          return { summary: "A mocked grounded answer", claims: [], citedEventIds: feed.events.map(event => event.id) };
        },
      },
      "@/lib/data/catalog": { getUniverseCatalog: async () => ({}) },
      "@/lib/data/ask-limit": { checkAskRateLimit: async () => null },
      "@/lib/data/dates": { isCalendarDay: () => true },
      "@/lib/data/storage": {
        getSnapshotFeed: async () => JSON.parse(JSON.stringify(snapshot)),
        hasCurrentSignalEmbeddings: async () => false,
        withStoredEvidence: forbiddenCurrentRead, getSignalEvidence: forbiddenCurrentRead,
      },
    }, { DATABASE_URL: "postgres://fixture.invalid/not-connected" });
  const response = await handleAsk(new Request("https://fixture.invalid/api/ask", {
    method: "POST", body: JSON.stringify({ question: "What happened?", day: "2026-10-23" }),
  }), new AbortController().signal);
  assert.equal(response.status, 200);
  assert.ok(summarized);
  assert.ok(summarized.events.every(event => event.evidence?.text === evidence(event.id).text));
  assert.equal(currentEvidenceReads, 0, "Historical Ask must use frozen evidence, never today's archive text");
});


test("snapshot evidence follows original observation identities and rejects changed or absent fingerprints", async () => {
  const alias = { ...event("alias"), url: "https://example.com/shared", evidence: evidence("alias") };
  const changed = { ...event("changed"), evidence: evidence("changed") };
  const without = event("without");
  const checkpoint = sourceCheckpoint({ observedAt, scope: "sample", partial: false,
    sources: { github: "ok" }, events: [alias, changed, without] });
  const selected = [...checkpoint.events, event("rolling")];
  // The original alias is persisted under a different canonical signal ID.
  const records = [
    { signal_id: "canonical", source: alias.source, external_id: alias.externalId,
      content_hash: checkpoint.evidenceRefs!.alias.contentHash, body: { ...alias.evidence, retrievedAt: "2026-10-24T12:00:00Z" } },
    { signal_id: changed.id, source: changed.source, external_id: changed.externalId,
      content_hash: "changed-after-fetch", body: { ...changed.evidence, text: "A newer, different passage" } },
  ];
  const archiveReads: string[] = [];
  const sql = Object.assign((strings: TemplateStringsArray | string[], ...values: unknown[]) => {
    if (!Object.hasOwn(strings, "raw")) return strings;
    const query = strings.join("?");
    if (query.includes("select distinct on(evidence.signal_id)")) {
      archiveReads.push(...values[0] as string[]);
      return [{ signal_id: "rolling", body: evidence("rolling"), title: event("rolling").title, summary: event("rolling").summary }];
    }
    assert.match(query, /evidence.source = incoming.source/);
    assert.match(query, /evidence.external_id = incoming.external_id/);
    assert.match(query, /evidence.content_hash = incoming.content_hash/);
    const references = values[0] as { id: string; source: string; external_id: string; content_hash: string }[];
    return references.flatMap(ref => records.filter(row => row.source === ref.source && row.external_id === ref.external_id
      && row.content_hash === ref.content_hash).map(row => ({ id: ref.id, body: row.body })));
  }, { json: (value: unknown) => value });
  const hydrate = loadFunction<(events: SignalEvent[], checkpoint: ReturnType<typeof sourceCheckpoint>) => Promise<SignalEvent[]>>(
    "./storage.ts", "withSnapshotEvidence", { "__sql": sql }, {}, "database = () => require('__sql');");
  const captured = await hydrate(selected, checkpoint);
  assert.deepEqual(archiveReads, ["rolling"], "Fresh observations never fall back to newer canonical evidence");
  assert.equal(captured[0].id, "alias");
  assert.equal(captured[0].title, alias.title);
  assert.equal(captured[0].summary, alias.summary);
  assert.equal(captured[0].evidence?.text, alias.evidence.text);
  assert.equal(captured[0].evidence?.retrievedAt, observedAt, "Preserve capture-time provenance when content is unchanged");
  assert.equal(captured[1].evidence, undefined, "Changed source text cannot replace checkpoint evidence");
  assert.equal(captured[2].evidence, undefined, "An observation without evidence cannot borrow another source's text");
  assert.equal(captured[3].evidence?.text, evidence("rolling").text);
});

test("checkpoint evidence fingerprints match the persisted size bound without retaining bodies", () => {
  const long = { ...event("long"), evidence: { ...evidence("long"), text: "x".repeat(13000) } };
  const checkpoint = sourceCheckpoint({ observedAt, scope: "sample", partial: false, sources: {}, events: [long] });
  assert.equal(checkpoint.events[0].evidence, undefined);
  assert.equal(checkpoint.evidenceRefs?.long.contentHash, evidenceFingerprint({ ...long.evidence, text: long.evidence.text.slice(0, 12000) }));
  assert.equal(checkpoint.evidenceRefs?.long.retrievedAt, observedAt);
  assert.ok(JSON.stringify(checkpoint).length < 1000);
});
