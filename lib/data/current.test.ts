import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SignalFeed } from "./model";

const compiled = ts.transpileModule(readFileSync(new URL("./current.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(readyIds: string[], broken = false, database = true) {
  const calls: boolean[] = [];
  const prepared = { observedAt: new Date().toISOString(), events: [{ id: "pending" }],
    sources: { github: "ok" }, partial: false, scope: "rolling", archiveCount: 401 };
  const testModule = { exports: {} as { getCurrentFeed: (readyOnly?: boolean) => Promise<SignalFeed> } };
  runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, process: { env: { DATABASE_URL: database ? "fixture" : "" } },
    require: (name: string) => {
      if (name === "./storage") return {
        getPersistedCurrentFeed: async () => prepared,
        getPublishedEvidenceCounts:async()=>({childCounts:{"ai-agents":7},relationships:{"ai:software":4},archiveRelationships:{"ai:software":12}}),
        getStoredFeed: async (readyOnly: boolean) => {
          calls.push(readyOnly);
          if (broken) throw new Error("Readiness unavailable");
          return readyIds.length ? { events: readyIds.map(id => ({ id })) } : null;
        },
      };
      if (name === "./feed") return { getSignalFeed: async () => { throw new Error("Public reads must not contact sources"); } };
      if (name === "./model") return { unavailableSources: () => ({ github: "unavailable" }) };
      return {};
    },
  });
  return { read: testModule.exports.getCurrentFeed, calls };
}

test("public feed reads newly completed stories independently of the hourly sample", async () => {
  const { read, calls } = harness(["newly-ready", "older-ready"]);
  const feed = await read(true);
  assert.deepEqual(Array.from(feed.events, event => event.id), ["newly-ready", "older-ready"]);
  assert.deepEqual(calls, [true]);
  assert.equal(feed.archiveCount, 401);
  assert.equal(feed.publishedEvidence?.childCounts["ai-agents"],7);
  assert.equal(feed.sources.github, "ok");
});

test("an empty ready queue stays empty without falling back to pending stories", async () => {
  const { read } = harness([]);
  assert.equal((await read(true)).events.length, 0);
});

test("publication fails closed if checking readiness fails", async () => {
  const { read } = harness([], true);
  await assert.rejects(read(true), /Readiness unavailable/);
});

test("internal archive consumers retain pending observations", async () => {
  const { read, calls } = harness([]);
  assert.equal((await read()).events[0].id, "pending");
  assert.deepEqual(calls, []);
});

test("a database-free public request does not fetch stories that cannot be published", async () => {
  const { read, calls } = harness([], false, false);
  assert.equal((await read(true)).events.length, 0);
  assert.deepEqual(calls, []);
});
