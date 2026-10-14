import assert from "node:assert/strict";
import test from "node:test";
import {awaitWithinDeadline,runAskWithDeadline} from "./deadline";
test("Ask deadline cancels stuck work and returns a usable failure response",async()=>{
  let aborted=false;
  const response=await runAskWithDeadline(signal=>new Promise((_,reject)=>{
    signal.addEventListener("abort",()=>{aborted=true;reject(new Error("Cancelled"));});
  }),5);
  assert.equal(response.status,503);assert.equal(aborted,true);
  assert.match((await response.json()).error,/more specific question/);
});
test("successful Ask requests keep their response and clear the timeout",async()=>{
  let signal:AbortSignal|undefined;
  const response=await runAskWithDeadline(async budget=>{signal=budget;return Response.json({answer:"Supported"});},5);
  assert.equal(response.status,200);
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(signal?.aborted,false);
});
test("provider work cannot hold a step open after its abort deadline",async()=>{
  const controller = new AbortController();
  const reason = new Error("Provider deadline expired");
  const timer = setTimeout(() => controller.abort(reason), 5);
  try { await assert.rejects(awaitWithinDeadline(new Promise<never>(() => {}), controller.signal), reason); }
  finally { clearTimeout(timer); }
});

test("provider deadline keeps success and rejection and handles already-aborted work", async () => {
  const controller = new AbortController();
  assert.equal(await awaitWithinDeadline(Promise.resolve("supported"), controller.signal), "supported");
  const failure = new Error("Provider failed");
  await assert.rejects(awaitWithinDeadline(Promise.reject(failure), controller.signal), failure);
  const reason = new Error("Cancelled");
  controller.abort(reason);
  await assert.rejects(awaitWithinDeadline(Promise.reject(failure), controller.signal), reason);
});
