import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { enrichOwnedBatch } from "./enrichment-worker";

// Execute the actual orchestration body with deterministic step dependencies.
// Production compilation separately checks Workflow transformation; these tests
// cover control flow, including finally, without starting a networked World.
const source = readFileSync(new URL("../../workflows/ingest-universe.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(options: { ownedBatches?: number; busy?: boolean; fail?: boolean; empty?: boolean; unconfigured?: boolean; throwProcessing?: boolean; attempt?: number; lostOnRetry?: boolean } = {}) {
  const calls: string[] = [];
  let renewals = 0;
  const testModule = { exports: {} as { enrichReadingNotes: (slot: string, lane: number) => Promise<{
    status: string; processed: number; ready: number; failed: number; embeddingStatus: string;
  }> } };
  const dependencies: Record<string, unknown> = {
    "workflow": { getStepMetadata: () => ({ attempt: options.attempt ?? 1 }) },
    "@/lib/data/enrichment": {
      claimReadingNoteWorker: async () => { calls.push("claim"); return !options.busy; },
      renewReadingNoteWorker: async () => { calls.push("retry-renew"); return !options.lostOnRetry; },
      releaseReadingNoteWorker: async () => { calls.push("release"); },
    },
    "@/lib/data/enrichment-worker": {
      enrichOwnedBatch: (lane: number, runId: string, retries: boolean, oldest: boolean) => enrichOwnedBatch(
        lane, runId, retries, oldest,
        async () => { calls.push("renew"); return renewals++ < (options.ownedBatches ?? 10); },
        async (limit, _synthesize, _context, preferRetries, preferOldest) => {
          calls.push(`process:${limit}:${preferRetries}:${preferOldest}`);
          if (options.throwProcessing) throw new Error("Processing unavailable");
          if (options.unconfigured) return { processed: 0, ready: 0, failed: 0, status: "not-configured" };
          if (options.empty) return { processed: 0, ready: 0, failed: 0, status: "ok" };
          return { processed: 1, ready: options.fail ? 0 : 1, failed: options.fail ? 1 : 0, status: options.fail ? "partial" : "ok" };
        }),
    },
    "@/lib/ai/gateway": { gatewayConfigured: () => !options.unconfigured },
    "@/lib/data/model": { unavailableSources: () => ({}) },
    "@/lib/data/storage": {
      getPendingEmbeddingEvents: async () => [],
      persistEmbeddings: async () => { calls.push("embed"); return 0; },
    },
  };
  runInNewContext(compiled, {
    module: testModule, exports: testModule.exports,
    require: (name: string) => dependencies[name] ?? {},
    console,
  });
  return { calls, run: testModule.exports.enrichReadingNotes };
}

test("a full retry lane keeps ten-note capacity and retry reservations", async () => {
  const { calls, run } = harness();
  const result = await run("slot", 0);
  assert.equal(result.status, "complete");
  assert.equal(result.processed, 10);
  assert.equal(result.ready, 10);
  assert.deepEqual(calls.filter(call => call.startsWith("process")), [
    ...Array(5).fill("process:1:true:false"), ...Array(5).fill("process:1:false:false"),
  ]);
  assert.equal(calls.at(-1), "release");
});

test("a retried first batch renews ownership instead of attempting a second claim", async () => {
  const { calls, run } = harness({ attempt: 2 });
  assert.equal((await run("slot", 0)).processed, 10);
  assert.equal(calls[0], "retry-renew");
  assert.ok(!calls.includes("claim"));
  assert.equal(calls.at(-1), "release");
});

test("a retried first batch cannot process after ownership is lost", async () => {
  const { calls, run } = harness({ attempt: 2, lostOnRetry: true });
  assert.equal((await run("slot", 0)).status, "lease-lost");
  assert.deepEqual(calls, ["retry-renew", "release"]);
});

test("lease loss preserves failed-note counts, skips embeddings, and releases the lane", async () => {
  const { calls, run } = harness({ ownedBatches: 1, fail: true });
  const result = await run("slot", 1);
  assert.equal(result.status, "lease-lost");
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.embeddingStatus, "not-run");
  assert.deepEqual(calls, ["claim", "renew", "process:1:false:false", "renew", "release"]);
});

test("a busy lane never processes or releases another worker's lease", async () => {
  const { calls, run } = harness({ busy: true });
  assert.equal((await run("slot", 3)).status, "busy");
  assert.deepEqual(calls, ["claim"]);
});

test("an empty oldest-note lane stops after one batch and releases ownership", async () => {
  const { calls, run } = harness({ empty: true });
  assert.equal((await run("slot", 3)).processed, 0);
  assert.deepEqual(calls, ["claim", "renew", "process:1:false:true", "release"]);
});

test("enrichment does not repeat the independent embedding pass", async () => {
  const { calls, run } = harness();
  const result = await run("slot", 1);
  assert.equal(result.processed, 10);
  assert.equal(result.embeddingStatus, "not-run");
  assert.ok(!calls.includes("embed"));
  assert.equal(calls.at(-1),"release");
});

test("a processing exception still releases the worker and skips embeddings", async () => {
  const { calls, run } = harness({ throwProcessing: true });
  await assert.rejects(run("slot", 1), /Processing unavailable/);
  assert.deepEqual(calls, ["claim", "renew", "process:1:false:false", "release"]);
});

test("a worker without Gateway configuration stops and releases ownership", async () => {
  const { calls, run } = harness({ unconfigured: true });
  assert.equal((await run("slot", 0)).status, "not-configured");
  assert.deepEqual(calls, ["claim", "renew", "process:1:true:false", "release"]);
});
