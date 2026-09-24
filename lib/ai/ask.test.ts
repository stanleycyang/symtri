import assert from "node:assert/strict";
import test from "node:test";
import { answerKnowledgeQuestion, answerQuestion, questionTopics, shouldSearchKnowledge } from "./ask";
import type { SignalEvent, SignalFeed } from "../data/model";

const observedAt = "2026-09-22T12:00:00.000Z";
function event(id: string, title: string, topicId: string, subtopicId: string): SignalEvent {
  return { id: `github:${id}`, source: "github", externalId: id, title,
    url: `https://github.com/example/${id}`, summary: title, publishedAt: observedAt,
    importance: 60, topics: [{ topicId, subtopicId, relevance: 1 }] };
}
const agents = event("agents", "A coding agent for repositories", "ai", "ai-agents");
const nuclear = event("nuclear", "Small nuclear reactors for data centers", "energy", "energy-nuclear");
const feed: SignalFeed = {
  observedAt, events: [agents, nuclear],
  sources: { "hacker-news": "ok", github: "ok", arxiv: "ok" }, partial: false, scope: "sample",
};

test("an agents question navigates to its thread with real evidence", () => {
  const result = answerQuestion("What's happening with AI agents?", feed);
  assert.deepEqual(result.regionIds, ["ai"]);
  assert.equal(result.subtopicId, "ai-agents");
  assert.deepEqual(result.pathSteps.map((step) => step.label), ["AI", "Agents"]);
  assert.equal(result.events[0].id, agents.id);
  assert.equal(result.evidenceCount, 1);
  assert.match(result.summary, /1 sampled signal matches Agents/);
  assert.equal(result.retrieval, "terms");
});

test("an empty historical answer refers to its snapshot", () => {
  const result = answerQuestion("What is happening with energy?", { ...feed, events: [], scope: "history" });
  assert.match(result.summary, /in this snapshot/);
  assert.doesNotMatch(result.summary, /feed continues to update/);
});

test("a cross-region question follows the map and discloses missing shared evidence", () => {
  const result = answerQuestion("What connects nuclear energy and AI?", feed);
  assert.deepEqual(result.regionIds, ["energy", "ai"]);
  assert.deepEqual(result.pathIds, ["energy", "ai"]);
  assert.deepEqual(result.pathSteps.map((step) => step.label), ["ENERGY", "Nuclear", "Power Demand", "AI Infrastructure", "AI"]);
  assert.match(result.summary, /no signal classified to both/);
  assert.deepEqual(new Set(result.events.map((item) => item.id)), new Set([agents.id, nuclear.id]));
});

test("a broad shared signal leads the evidence without claiming a nuclear connection", () => {
  const shared = { ...event("shared", "AI forecasts solar output", "ai", "ai-agents"),
    topics: [{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }, { topicId: "energy", subtopicId: "energy-solar", relevance: 1 }] };
  const result = answerQuestion("What connects nuclear energy and AI?", { ...feed, events: [agents, nuclear, shared] });
  assert.equal(result.events[0].id, shared.id);
  assert.match(result.summary, /1 sampled signal links Energy and Artificial Intelligence/);
  assert.match(result.summary, /None of those shared signals is tagged Nuclear/);
});

test("the curated route reverses with question order and stays out of broad questions", () => {
  const reversed = answerQuestion("How does AI connect to nuclear energy?", feed);
  assert.deepEqual(reversed.pathSteps.map((step) => step.label), ["AI", "AI Infrastructure", "Power Demand", "Nuclear", "ENERGY"]);
  const broad = answerQuestion("How does AI connect to energy?", feed);
  assert.deepEqual(broad.pathSteps.map((step) => step.label), ["AI", "ENERGY"]);
});

test("a cross-region answer names a region absent from the current sample", () => {
  const result = answerQuestion("What connects nuclear energy and AI?", { ...feed, events: [agents] });
  assert.match(result.summary, /Energy has no source in this sample/);
  assert.deepEqual(result.events.map((item) => item.id), [agents.id]);
});

test("a cross-region answer shows one recent source per side without filler", () => {
  const oldAi = { ...agents, publishedAt: "2026-09-20T12:00:00.000Z" };
  const recentAi = { ...event("recent-ai", "New coding agent", "ai", "ai-agents"), publishedAt: "2026-09-22T11:00:00.000Z" };
  const extraEnergy = { ...event("solar", "Solar array update", "energy", "energy-solar"), publishedAt: "2026-09-22T11:30:00.000Z" };
  const result = answerQuestion("What connects nuclear energy and AI?", { ...feed, events: [oldAi, recentAi, nuclear, extraEnergy] });
  assert.deepEqual(result.events.map((item) => item.id), [nuclear.id, recentAi.id]);
  assert.equal(result.events.length, 2);
});

test("an open question selects the most active observed region", () => {
  const result = answerQuestion("What is drawing attention?", feed);
  assert.equal(result.regionIds.length, 1);
  assert.ok(["ai", "energy"].includes(result.regionIds[0]));
});

test("a thread without exact evidence labels broader region sources", () => {
  const result = answerQuestion("What is happening with AI robotics?", feed);
  assert.equal(result.subtopicId, "ai-robotics");
  assert.match(result.summary, /No sampled signal matches Robotics exactly/);
  assert.equal(result.events[0].id, agents.id);
});

test("semantic similarity reorders sources only within the identified region", () => {
  const first = event("first", "Repository notes", "ai", "ai-agents");
  const second = event("second", "Tooling notes", "ai", "ai-agents");
  const unrelated = event("other", "Unrelated market notes", "markets", "markets-economy");
  const result = answerQuestion("What's happening with AI agents?", { ...feed, events: [first, second, unrelated] }, [
    { id: first.id, similarity: .1 }, { id: second.id, similarity: .9 }, { id: unrelated.id, similarity: 1 },
  ]);
  assert.deepEqual(result.events.map((item) => item.id), [second.id, first.id]);
  assert.equal(result.regionIds[0], "ai");
  assert.equal(result.retrieval, "semantic-assisted");
});

test("unmapped subjects use the knowledge archive without inventing a map location", () => {
  assert.deepEqual(questionTopics("What's happening with AI agents?"), [{ id: "ai", childId: "ai-agents" }]);
  assert.deepEqual(questionTopics("What is drawing attention?"), []);
  assert.equal(shouldSearchKnowledge("What is happening with AI agents?"), false);
  assert.equal(shouldSearchKnowledge("What is drawing attention?"), false);
  assert.equal(shouldSearchKnowledge("What is new with urban gardening?"), true);
  const garden = { ...event("garden", "Urban gardens", "science", "science-climate-science"), topics: [] };
  const result = answerKnowledgeQuestion("What is new with urban gardening?", [{ event: garden, similarity: .7 }]);
  assert.equal(result.scope, "knowledge");
  assert.deepEqual(result.regionIds, []);
  assert.deepEqual(result.events.map((item) => item.id), [garden.id]);
});
