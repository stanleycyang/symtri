import assert from "node:assert/strict";
import test from "node:test";
import {runAskWithDeadline} from "./deadline";
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
