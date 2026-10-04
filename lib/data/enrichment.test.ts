import assert from "node:assert/strict";
import test from "node:test";
import { archivedAbstractEvidence, hackerNewsDiscussionEvidence, readingNoteFailureCode } from "./enrichment";
import type { SignalEvent } from "./model";
import type { fetchPublicText } from "./public-fetch";

const event: SignalEvent = { id: "arxiv:2609.12345", source: "arxiv", externalId: "2609.12345",
  title: "A source paper", url: "https://arxiv.org/abs/2609.12345",
  summary: "This paper reports a measured result under controlled conditions and explains the method used to obtain it. The authors also describe where the method does not apply in the tested setting.",
  publishedAt: "2026-09-28T00:00:00.000Z", importance: 25, topics: [] };

test("archived abstracts become attributed source excerpts", () => {
  const arxiv = archivedAbstractEvidence(event);
  assert.equal(arxiv?.kind, "preprint");
  assert.equal(arxiv?.metadata?.archivedExcerpt, true);
  const openalex = archivedAbstractEvidence({ ...event, source: "openalex", url: "https://doi.org/10.1234/example" });
  assert.equal(openalex?.kind, "abstract");
  assert.equal(openalex?.url, "https://doi.org/10.1234/example");
  assert.equal(archivedAbstractEvidence({ ...event, source: "github" }), null);
  assert.equal(archivedAbstractEvidence({ ...event, summary: "A short title only." }), null);
});

test("Hacker News self-posts retain the author's text as discussion evidence", async () => {
  const story = { ...event, id: "hacker-news:123", source: "hacker-news", externalId: "123", url: "https://news.ycombinator.com/item?id=123" };
  const body = "The author describes a concrete change observed in a publishing workflow and asks other users whether they saw the same change. ".repeat(2);
  const calls: string[] = [];
  const load = (async (url: string) => { calls.push(url); return { url, contentType: "application/json", text: JSON.stringify({ type: "story", by: "writer", text: body, kids: [456] }) }; }) as typeof fetchPublicText;
  const evidence = await hackerNewsDiscussionEvidence(story, load);
  assert.equal(evidence?.kind, "discussion");
  assert.equal(evidence?.attribution, "Hacker News post author");
  assert.deepEqual(calls, ["https://hacker-news.firebaseio.com/v0/item/123.json"]);
});

test("Hacker News fallback uses bounded public comments and rejects empty discussions", async () => {
  const story = { ...event, id: "hacker-news:123", source: "hacker-news", externalId: "123", url: "https://example.org/blocked" };
  const comment = "This commenter describes a reproducible behavior in the linked project, including the steps used and the observed result. ".repeat(2);
  const load = (async (url: string) => ({ url, contentType: "application/json", text: JSON.stringify(url.endsWith("123.json")
    ? { type: "story", kids: [456, 789] }
    : url.endsWith("456.json") ? { type: "comment", by: "reviewer", text: comment }
    : { type: "comment", deleted: true }) })) as typeof fetchPublicText;
  const evidence = await hackerNewsDiscussionEvidence(story, load);
  assert.equal(evidence?.kind, "discussion");
  assert.match(evidence?.text ?? "", /Comment by reviewer:/);
  assert.equal(evidence?.url, "https://news.ycombinator.com/item?id=123");
  const empty = (async (url: string) => ({ url, contentType: "application/json", text: JSON.stringify({ type: "story", kids: [] }) })) as typeof fetchPublicText;
  await assert.rejects(hackerNewsDiscussionEvidence(story, empty), /Insufficient Hacker News discussion text/);
});

test("worker failures retain a safe, stage-specific diagnosis", () => {
  assert.equal(readingNoteFailureCode("evidence", new Error("Feed returned HTTP 403")), "source-http-403");
  assert.equal(readingNoteFailureCode("evidence", new Error("Insufficient source text")), "source-too-thin");
  assert.equal(readingNoteFailureCode("generate", new Error("Claim lacked a valid source passage")), "quote-rejected");
  assert.equal(readingNoteFailureCode("generate", new Error("Summary contained an unsupported claim")), "support-rejected");
  assert.equal(readingNoteFailureCode("generate", Object.assign(new Error("Provider rejected request"), { statusCode: 402 })), "model-http-402");
  assert.equal(readingNoteFailureCode("commit", new Error("connection reset")), "commit-error");
});
