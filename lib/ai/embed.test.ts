import assert from "node:assert/strict";
import test from "node:test";
import { EMBEDDING_DIMENSIONS, embedTexts, embeddingInputHash } from "./embed";

test("embedding requests batch inputs and restore response order", async () => {
  const sizes: number[] = [];
  let offset = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const batch = body.input as string[];
    sizes.push(batch.length);
    assert.equal(body.dimensions, EMBEDDING_DIMENSIONS);
    const data = batch.map((_, index) => ({ index, embedding: [offset + index, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)] })).reverse();
    offset += batch.length;
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  const vectors = await embedTexts(Array.from({ length: 65 }, (_, index) => `Signal ${index}`), "test-key", fetcher);
  assert.deepEqual(sizes, [64, 1]);
  assert.deepEqual(vectors.map((vector) => vector[0]), Array.from({ length: 65 }, (_, index) => index));
});

test("embedding input hashes change when content changes and malformed vectors fail", async () => {
  assert.notEqual(embeddingInputHash("first"), embeddingInputHash("second"));
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), { status: 200 });
  await assert.rejects(embedTexts(["test"], "test-key", fetcher), /invalid vector/);
});
