import assert from "node:assert/strict";
import test from "node:test";
import { readAskStream, streamAskResponse } from "./ask-stream";
import { runAskWithDeadline } from "./deadline";
import type { AskResult } from "./ask";
const answer = { summary: "Source-backed answer 🌍" } as AskResult;

test("preview reaches the reader while the final audit is still pending", async () => {
  let finish!: () => void;
  const audit = new Promise<void>(resolve => { finish = resolve; });
  const response = streamAskResponse(new AbortController().signal, async (_, publish) => {
    publish(answer);
    await audit;
    return Response.json({ ...answer, summary: "Verified synthesis" });
  });
  let observed!: () => void;
  const first = new Promise<void>(resolve => { observed = resolve; });
  const result = readAskStream(response, preview => { assert.equal(preview.summary, answer.summary); observed(); });
  await first;
  finish();
  assert.equal((await result).summary, "Verified synthesis");
});

test("network chunks may split JSON records and multibyte characters", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ type: "complete", answer }) + "\n");
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }));
  assert.equal((await readAskStream(response, () => {})).summary, answer.summary);
});

test("an interrupted stream cannot promote its preview to a completed answer", async () => {
  const response = new Response(JSON.stringify({ type: "preview", answer }) + "\n");
  await assert.rejects(readAskStream(response, () => {}), /interrupted/);
});

test("the deadline still ends stuck synthesis after a preview has flushed", async () => {
  const response = streamAskResponse(new AbortController().signal, (_, publish) => runAskWithDeadline(async () => {
    publish(answer);
    await new Promise(() => {});
    return Response.json(answer);
  }, 5));
  await assert.rejects(readAskStream(response, () => {}), /could not finish/);
});

test("reader cancellation aborts model work", async () => {
  let signal: AbortSignal | undefined;
  const response = streamAskResponse(new AbortController().signal, async (budget, publish) => {
    signal = budget;
    publish(answer);
    await new Promise(resolve => budget.addEventListener("abort", resolve, { once: true }));
    return Response.json(answer);
  });
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(signal?.aborted, true);
});
