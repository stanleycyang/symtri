import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SignalFeed } from "./model";

const source = readFileSync(new URL("../../workflows/ingest-universe.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("source checkpoints persist all observations before dropping evidence from the workflow payload", async () => {
  const feed: SignalFeed = {
    observedAt: "2026-10-23T12:00:00Z", scope: "sample", partial: false,
    sources: { github: "ok", "hacker-news": "ok" },
    events: ["github", "hacker-news"].map(source => ({
      id: `${source}:one`, source, externalId: "one", title: "Shared repository", url: "https://github.com/example/repository",
      summary: "A shorter display summary", publishedAt: "2026-10-23T11:00:00Z", importance: .5, topics: [],
      classificationInput: { title: "Original title", summary: "Original classification text", categories: ["software"] },
      evidence: { text: "Retained source passage ".repeat(500), url: "https://example.com/source", kind: "repository" as const,
        attribution: source, license: null, retrievedAt: "2026-10-23T12:00:00Z" },
    })),
  };
  let persisted = false;
  const testModule = { exports: {} as { checkpoint: (slot: string) => Promise<SignalFeed> } };
  const dependencies: Record<string, unknown> = {
    "@/lib/data/feed": { getSignalFeed: async () => feed },
    "@/lib/data/feed-registry": {
      fetchActiveFeeds: async () => ({ events: [], sources: {} }),
      recoverPausedFeeds: async () => ({ events: [], sources: {} }),
    },
    "@/lib/data/catalog": { seedUniverseCatalog: async () => {} },
    "@/lib/data/storage": { persistSignals: async (value: SignalFeed) => {
      assert.equal(value.events.length, 2);
      assert.ok(value.events.every(event => event.evidence?.text && event.classificationInput));
      persisted = true;
    } },
  };
  runInNewContext(`${compiled}\nmodule.exports.checkpoint = fetchSources;`, {
    module: testModule, exports: testModule.exports,
    require: (name: string) => dependencies[name] ?? {}, console,
  });
  const checkpoint = await testModule.exports.checkpoint("slot");
  assert.ok(persisted);
  assert.equal(checkpoint.events.length, 2);
  assert.ok(checkpoint.events.every(event => !event.evidence && event.classificationInput));
  assert.deepEqual(checkpoint.sources, feed.sources);
  assert.ok(feed.events.every(event => event.evidence?.text));
  assert.ok(JSON.stringify(checkpoint).length < JSON.stringify(feed).length / 5);
});
