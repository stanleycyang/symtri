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
  sources: { "hacker-news": "unavailable", github: "ok", arxiv: "unavailable", openalex: "unavailable" },
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

test("rolling view keeps one page when another source discovers its URL", () => {
  const stored = event("stored", "2026-09-22T12:00:00.000Z");
  const rediscovered: SignalEvent = {
    ...event("hacker-news:77", "2026-09-23T11:00:00.000Z"),
    source: "hacker-news", externalId: "77", title: "Fresh discussion",
    url: "https://GITHUB.com/example/stored/?ref=hn",
  };
  const result = rollingFeed(feed([rediscovered], "sample"), feed([stored], "archive"), 1);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].id, rediscovered.id);
  assert.equal(result.events[0].title, "Fresh discussion");
});

test("rolling view hides an archived copy of the same content at another URL", () => {
  const stored = event("stored", "2026-09-22T12:00:00.000Z");
  const rediscovered = { ...stored, id: "hacker-news:78", source: "hacker-news" as const,
    externalId: "78", url: "https://mirror.example/stored", publishedAt: "2026-09-23T11:00:00.000Z" };
  const result = rollingFeed(feed([rediscovered], "sample"), feed([stored], "archive"), 1);
  assert.deepEqual(result.events.map((item) => item.id), [rediscovered.id]);
});

test("rolling view retains archive during a source outage and caps map payload", () => {
  const archive = feed(Array.from({ length: 350 }, (_, index) => event(`id-${index}`, `2026-09-22T${String(index % 24).padStart(2, "0")}:00:00.000Z`)), "archive");
  const empty = feed([], "sample");
  const result = rollingFeed(empty, archive, 350);
  assert.equal(result.scope, "archive");
  assert.equal(result.events.length, 300);
  assert.equal(result.archiveCount, 350);
});

test("daily snapshot keeps a journal paper after 300 newer timestamped posts", () => {
  const newer = Array.from({ length: 300 }, (_, index) => event(`recent-${index}`, "2026-09-24T16:00:00.000Z"));
  const journal: SignalEvent = { ...event("openalex:W77", "2026-09-24T00:00:00.000Z"),
    source: "openalex", externalId: "W77", url: "https://doi.org/10.1234/w77" };
  const result = rollingFeed(feed(newer, "sample"), feed([journal], "archive"), 301);
  assert.equal(result.events.length, 300);
  assert.ok(result.events.some((item) => item.id === journal.id));
  assert.equal(result.events.filter((item) => item.source === "github").length, 299);
});
