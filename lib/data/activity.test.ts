import assert from "node:assert/strict";
import test from "node:test";
import { attentionEdges, flowingAttentionEdges, regionActivity, regionRelationships, relationshipKey } from "./activity";
import type { SignalEvent } from "./model";

const now = Date.parse("2026-09-22T12:00:00Z");
function event(id: number, region: string, hoursAgo: number, importance = 50): SignalEvent {
  return { id: `github:${id}`, source: "github", externalId: String(id), title: "sample", url: `https://github.com/example/${id}`,
    summary: "sample", publishedAt: new Date(now - hoursAgo * 3_600_000).toISOString(), importance,
    topics: [{ topicId: region, subtopicId: null, relevance: 1 }] };
}

test("recent signals increase visual energy and momentum without moving regions", () => {
  const activity = regionActivity([event(1, "ai", 2), event(2, "ai", 3), event(3, "ai", 4), event(4, "software", 30)], now);
  assert.equal(activity.ai.count, 3);
  assert.equal(activity.ai.momentum, "rising");
  assert.ok(activity.ai.visual > activity.software.visual);
  assert.equal(activity.crypto.visual, 18);
  assert.equal(activity.software.momentum, "steady");
});

test("an event contributes once per region and expired events do not count", () => {
  const item = event(1, "ai", 1);
  item.topics.push({ topicId: "ai", subtopicId: "ai-agents", relevance: .5 });
  const activity = regionActivity([item, event(2, "ai", 400)], now);
  assert.equal(activity.ai.count, 1);
  assert.equal(activity.ai.score, .85 * 2 ** (-1 / 24));
});

test("relationships count distinct shared signals and ignore repeated topic matches", () => {
  const shared = event(1, "ai", 1);
  shared.topics.push({ topicId: "security", subtopicId: null, relevance: .8 });
  shared.topics.push({ topicId: "security", subtopicId: "security-privacy", relevance: .5 });
  const second = event(2, "security", 2);
  second.topics.push({ topicId: "ai", subtopicId: null, relevance: .7 });
  const relationships = regionRelationships([shared, second, event(3, "ai", 400)], now);
  assert.equal(relationships["ai:security"], 2);
  assert.equal(Object.keys(relationships).length, 1);
});

test("current attention limits emerging links and stops flow on archive-only routes", () => {
  const recent = { "ai:markets": 6, "ai:security": 4, "hardware:markets": 3, "markets:security": 2, "crypto:science": 2,
    "energy:security": 2, "crypto:software": 2, "ai:energy": 0 };
  const edges = attentionEdges(recent);
  const emerging = edges.filter(([first, second]) => !attentionEdges(null).some(([a, b]) => relationshipKey(a, b) === relationshipKey(first, second)));
  assert.equal(emerging.length, 6);
  assert.ok(emerging.some(([first, second]) => relationshipKey(first, second) === "ai:markets"));
  assert.ok(!emerging.some(([first, second]) => relationshipKey(first, second) === "markets:security"));
  const flowing = flowingAttentionEdges(edges, recent);
  assert.ok(flowing.some(([first, second]) => relationshipKey(first, second) === "ai:markets"));
  assert.ok(!flowing.some(([first, second]) => relationshipKey(first, second) === "ai:energy"));
});
