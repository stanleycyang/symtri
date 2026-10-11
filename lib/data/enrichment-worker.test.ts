import assert from "node:assert/strict";
import test from "node:test";
import { enrichOwnedBatch } from "./enrichment-worker";

test("a worker that lost its lease cannot process another batch", async () => {
  const result = await enrichOwnedBatch(3, "run:3", false, true,
    async (lane, runId) => {
      assert.equal(lane, 3);
      assert.equal(runId, "run:3");
      return false;
    },
    async () => { throw new Error("Processing must not start"); });
  assert.deepEqual(result, { processed: 0, ready: 0, failed: 0, status: "lease-lost" });
});

test("renewal completes before processing and preserves capacity and priorities", async () => {
  let renewed = false;
  const batch = { processed: 1, ready: 0, failed: 1, status: "partial" };
  const result = await enrichOwnedBatch(0, "run:0", true, false,
    async () => { renewed = true; return true; },
    async (limit, synthesize, context, preferRetries, preferOldest) => {
      assert.ok(renewed);
      assert.equal(limit, 1);
      assert.equal(synthesize, undefined);
      assert.equal(context, undefined);
      assert.equal(preferRetries, true);
      assert.equal(preferOldest, false);
      return batch;
    });
  assert.deepEqual(result, {processed:5,ready:0,failed:5,status:"partial"});
});

test("a processing retry rechecks ownership after a transient failure", async () => {
  let owned = true;
  let processed = 0;
  const renew = async () => owned;
  const processBatch = async () => { processed++; throw new Error("Database unavailable"); };
  await assert.rejects(enrichOwnedBatch(1, "run:1", false, false, renew, processBatch), /Database unavailable/);
  owned = false;
  assert.equal((await enrichOwnedBatch(1, "run:1", false, false, renew, processBatch)).status, "lease-lost");
  assert.equal(processed, 1);
});

test("a failed renewal propagates for Workflow retry without processing", async () => {
  await assert.rejects(enrichOwnedBatch(1, "run:1", false, false,
    async () => { throw new Error("Renewal unavailable"); },
    async () => { throw new Error("Processing must not start"); }), /Renewal unavailable/);
});

test("an owned retry renews again and keeps the oldest-note priority", async () => {
  let renewals = 0;
  let attempts = 0;
  const renew = async () => { renewals++; return true; };
  const processBatch = async (_limit: number | undefined, _synthesize: unknown, _context: unknown,
    preferRetries: boolean | undefined, preferOldest: boolean | undefined) => {
    assert.equal(renewals, attempts + 1);
    assert.equal(preferRetries, false);
    assert.equal(preferOldest, true);
    if (++attempts === 1) throw new Error("Transient database failure");
    return { processed: 0, ready: 0, failed: 0, status: "ok" };
  };
  await assert.rejects(enrichOwnedBatch(3, "run:3", false, true, renew, processBatch), /Transient/);
  assert.equal((await enrichOwnedBatch(3, "run:3", false, true, renew, processBatch)).status, "ok");
  assert.equal(renewals, 2);
});

test("a slow batch stops claiming new notes at its time budget",async()=>{
  let clock=0,processed=0;
  const result=await enrichOwnedBatch(0,"run",false,false,async()=>true,async()=>{
    processed++;clock+=70_000;return {processed:1,ready:1,failed:0,status:"ok"};
  },()=>clock);
  assert.equal(processed,2);
  assert.equal(result.ready,2);
});

test("lease loss within a batch keeps already committed work",async()=>{
  let renewals=0;
  const result=await enrichOwnedBatch(0,"run",false,false,async()=>++renewals===1,async()=>({processed:1,ready:1,failed:0,status:"ok"}));
  assert.deepEqual(result,{processed:1,ready:1,failed:0,status:"lease-lost"});
});
