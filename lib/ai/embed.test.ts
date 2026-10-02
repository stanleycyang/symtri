import assert from "node:assert/strict";
import test from "node:test";
import type { SignalEvent } from "../data/model";
import { MockEmbeddingModelV4 } from "ai/test";
import { EMBEDDING_DIMENSIONS, embedTexts, embeddingInputHash,signalEmbeddingText } from "./embed";

test("gateway embeddings batch inputs and preserve response order", async () => {
  const sizes: number[] = [];
  let offset = 0;
  const model = new MockEmbeddingModelV4({ maxEmbeddingsPerCall: 64, doEmbed: async ({ values }) => {
    sizes.push(values.length);
    const embeddings = values.map((_, index) => [offset + index, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)]);
    offset += values.length;
    return { embeddings, warnings: [] };
  } });
  const vectors = await embedTexts(Array.from({ length: 65 }, (_, index) => `Signal ${index}`), model);
  assert.deepEqual(sizes, [64, 1]);
  assert.deepEqual(vectors.map((vector) => vector[0]), Array.from({ length: 65 }, (_, index) => index));
  assert.equal(model.doEmbedCalls[0].providerOptions?.openai?.dimensions, EMBEDDING_DIMENSIONS);
});

test("embedding input hashes change when content changes and malformed vectors fail", async () => {
  assert.notEqual(embeddingInputHash("first"), embeddingInputHash("second"));
  const model = new MockEmbeddingModelV4({ doEmbed: { embeddings: [[1]], warnings: [] } });
  await assert.rejects(embedTexts(["test"], model), /invalid vector/);
  const originalHash = embeddingInputHash("same");
  const original = process.env.SYMTRI_EMBEDDING_MODEL;
  try {
    process.env.SYMTRI_EMBEDDING_MODEL = "google/gemini-embedding-001";
    assert.notEqual(originalHash, embeddingInputHash("same"));
    const googleModel = new MockEmbeddingModelV4({ doEmbed: { embeddings: [Array(EMBEDDING_DIMENSIONS).fill(0)], warnings: [] } });
    await embedTexts(["test"], googleModel);
    assert.equal(googleModel.doEmbedCalls[0].providerOptions?.google?.outputDimensionality, EMBEDDING_DIMENSIONS);
  } finally {
    if (original === undefined) delete process.env.SYMTRI_EMBEDDING_MODEL;
    else process.env.SYMTRI_EMBEDDING_MODEL = original;
  }
});


test("signal vectors include bounded source evidence and exclude generated notes",()=>{
  const event={title:"A short title",summary:"Display summary",evidence:{text:"Retained findings. ".repeat(1000),kind:"abstract",url:"https://example.org",attribution:"Authors",license:null,retrievedAt:"2026-09-28"}} as SignalEvent;
  const text=signalEmbeddingText(event);
  assert.ok(text.includes("Source text: Retained findings."));
  assert.ok(text.length<3100);
  assert.notEqual(embeddingInputHash(text),embeddingInputHash(signalEmbeddingText({...event,evidence:undefined})));
});
