import assert from "node:assert/strict";
import test from "node:test";
import { seedCatalog } from "../universe";
import { connectionsFor, threadCounts, threadOrigin } from "./exploration";
import type { SignalFeed } from "./model";

const feed: SignalFeed = { scope: "rolling", observedAt: "2026-09-27T12:00:00Z", partial: false, sources: {},
  childCounts: { "ai-agents": 327 }, relationships: { "ai:software": 204, "hardware:software": 19 }, events: [{
    id: "github:one", externalId: "one", source: "github", title: "Agent tools", summary: "", url: "https://example.com/one",
    publishedAt: "2026-09-27T10:00:00Z", importance: 20, topics: [
      { topicId: "ai", subtopicId: "ai-agents", relevance: 1 },
      { topicId: "ai", subtopicId: "ai-agents", relevance: .5 },
      { topicId: "software", subtopicId: "software-developer-tools", relevance: 1 },
    ],
  }] };

test("live labels use full archive counts; snapshots count their saved sample once per source", () => {
  assert.equal(threadCounts(feed)["ai-agents"], 327);
  assert.deepEqual(threadCounts({ ...feed, scope: "history" }), { "ai-agents": 1, "software-developer-tools": 1 });
  assert.deepEqual(threadCounts(null), {});
  assert.equal(threadCounts(feed)["startups-product"] ?? 0, 0);
});

test("connection navigation includes seeded quiet routes and evidence beyond the overview cap", () => {
  const links = connectionsFor("software", feed, seedCatalog);
  assert.equal(links.find((link) => link.topic.id === "ai")?.recent, 204);
  assert.equal(links.find((link) => link.topic.id === "hardware")?.recent, 19);
  const quiet = links.find((link) => link.topic.id === "startups");
  assert.equal(quiet?.seeded, true);
  assert.equal(quiet?.recent, 0);
  assert.equal(links.some((link) => link.topic.id === "software"), false);
  const historical = connectionsFor("software", { ...feed, scope: "history", knowledgeGraph: {
    updatedAt: feed.observedAt, regionCounts: {}, relationships: { "software:space": 20 },
  } }, seedCatalog);
  assert.equal(historical.some((link) => link.topic.id === "space"), false);
});

test("sample feeds derive shared evidence and explain seeded versus grown threads", () => {
  assert.equal(connectionsFor("software", { ...feed, relationships: undefined }, seedCatalog).find((link) => link.topic.id === "ai")?.recent, 1);
  assert.match(threadOrigin("startups-product"), /starting thread/);
  assert.match(threadOrigin("organic-test"), /repeated source evidence/);
});
