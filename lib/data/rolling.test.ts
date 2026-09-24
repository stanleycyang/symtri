import assert from "node:assert/strict";
import { test } from "node:test";
import { rollingFeed } from "./rolling";
import type { SignalEvent, SignalFeed } from "./model";

const event = (id: string, publishedAt: string): SignalEvent => ({
  id, source: "github", externalId: id, title: id, url: `https://github.com/example/${id}`,
  summary: id, publishedAt, importance: 50, topics: [{ topicId: "ai", subtopicId: null, relevance: 1 }],
});
const feed = (events: SignalEvent[], scope: SignalFeed["scope"]): SignalFeed => ({
  observedAt: "2026-09-23T12:00:00.000Z", events,
  sources: { "hacker-news": "unavailable", github: "ok", arxiv: "unavailable" },
  partial: true, scope,
});

test("rolling view deduplicates archived signals and prefers fresh details", () => {
  const archive = feed([event("old", "2026-09-20T12:00:00.000Z"), event("shared", "2026-09-22T12:00:00.000Z")], "archive");
  const live = feed([{ ...event("shared", "2026-09-22T12:00:00.000Z"), title: "Updated" }, event("new", "2026-09-23T11:00:00.000Z")], "sample");
  const result = rollingFeed(live, archive, 400);
  assert.equal(result.scope, "rolling");
  assert.equal(result.archiveCount, 400);
  assert.deepEqual(result.events.map((item) => item.id), ["new", "shared", "old"]);
  assert.equal(result.events[1].title, "Updated");
  assert.deepEqual(result.sources, live.sources);
});

test("rolling view retains archive during a source outage and caps map payload", () => {
  const archive = feed(Array.from({ length: 350 }, (_, index) => event(`id-${index}`, `2026-09-22T${String(index % 24).padStart(2, "0")}:00:00.000Z`)), "archive");
  const empty = feed([], "sample");
  const result = rollingFeed(empty, archive, 350);
  assert.equal(result.scope, "archive");
  assert.equal(result.events.length, 300);
  assert.equal(result.archiveCount, 350);
});
