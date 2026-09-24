import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateProductionHealth } from "./health";

const now = new Date("2026-09-24T20:12:00Z");
const status = {
  signals: 100, vectors: 100, embeddingBacklog: 0, classificationBacklog: 0,
  lastRun: { startedAt: "2026-09-24T20:00:30Z", completedAt: "2026-09-24T20:01:10Z",
    status: "complete", sources: { "hacker-news": "ok" }, fetched: 20, mapped: 15,
    added: 10, embedded: 10, embeddingStatus: "ok" },
} as Parameters<typeof evaluateProductionHealth>[1];
const growth = { catalogBacklog: 0, graphDirtyDays: 0,
  rss: { active: 1, capacity: 60, trial: 0, recoverable: 0, manual: 0, capacityPaused: 0 },
  public_points: 76, organic_points: 0, inactive_points: 0, candidates: 0, sources: { active: 5 },
} as Parameters<typeof evaluateProductionHealth>[2];
const feed = { observedAt: "2026-09-24T20:00:45Z", archiveCount: 100,
  events: [{ id: "sample", source: "hacker-news", externalId: "sample", title: "Sample report",
    url: "https://example.com/sample", summary: "Sample evidence", publishedAt: "2026-09-24T20:00:00Z",
    importance: 50, topics: [] }], sources: { "hacker-news": "ok" }, partial: false, scope: "rolling" } as Parameters<typeof evaluateProductionHealth>[3];
const day = { day: "2026-09-24", capturedAt: "2026-09-24T20:00:45Z", eventCount: 1 };

test("launch day is healthy with one real snapshot", () => {
  assert.equal(evaluateProductionHealth(now, status, growth, feed, [day], "2026-09-24").status, "healthy");
});

test("the next UTC day requires a fresh run and both dated snapshots", () => {
  const next = new Date("2026-09-25T00:12:00Z");
  const missing = evaluateProductionHealth(next, status, growth, feed, [day], "2026-09-24");
  assert.equal(missing.status, "degraded");
  assert.ok(missing.issues.some((issue) => issue.includes("Current UTC hour")));
  assert.ok(missing.issues.some((issue) => issue.includes("Today")));
  const fresh = { ...status, lastRun: { ...status.lastRun!, startedAt: "2026-09-25T00:00:30Z",
    completedAt: "2026-09-25T00:01:10Z" } } as Parameters<typeof evaluateProductionHealth>[1];
  const freshFeed = { ...feed, observedAt: "2026-09-25T00:00:45Z" } as Parameters<typeof evaluateProductionHealth>[3];
  const current = { day: "2026-09-25", capturedAt: "2026-09-25T00:00:45Z", eventCount: 1 };
  assert.equal(evaluateProductionHealth(next, fresh, growth, freshFeed, [current, day], "2026-09-24").status, "healthy");
  assert.ok(evaluateProductionHealth(next, fresh, growth, freshFeed, [current], "2026-09-24").issues.some((issue) => issue.includes("Yesterday")));
});

test("graph and vector backlog degrade a completed run", () => {
  const result = evaluateProductionHealth(now, { ...status, embeddingBacklog: 4 },
    { ...growth, graphDirtyDays: 1 }, feed, [day], "2026-09-24");
  assert.equal(result.status, "degraded");
  assert.ok(result.issues.some((issue) => issue.includes("Embedding")));
  assert.ok(result.issues.some((issue) => issue.includes("Knowledge graph")));
});
