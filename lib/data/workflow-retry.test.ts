import assert from "node:assert/strict";
import test from "node:test";
import { embeddingStepError } from "./workflow-retry";

test("invalid provider credentials and requests never spend Workflow retries", async () => {
  const { FatalError } = await import("workflow");
  for (const statusCode of [400, 401, 402, 403, 404, 422]) {
    assert.ok(await embeddingStepError({ statusCode }, 1) instanceof FatalError);
  }
});

test("rate limits, server failures and transport errors use bounded durable backoff", async () => {
  const { RetryableError } = await import("workflow");
  for (const error of [{ statusCode: 429 }, { statusCode: 503 }, new Error("timeout")]) {
    for (const [attempt, delay] of [[1, 30_000], [2, 60_000], [3, 120_000], [10, 300_000]]) {
      const before = Date.now();
      const next = await embeddingStepError(error, attempt);
      assert.ok(next instanceof RetryableError);
      assert.ok(next.retryAfter.getTime() >= before + delay);
      assert.ok(next.retryAfter.getTime() <= Date.now() + delay);
    }
  }
});
