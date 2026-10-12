import {test} from "node:test";
import assert from "node:assert/strict";
import {digestIntro} from "./digest";
import {buildWeeklyDigest} from "../data/digest";
import type {SignalFeed} from "../data/model";
const feed:SignalFeed={observedAt:"2026-10-09",sources:{},partial:false,scope:"history",events:[{id:"a",source:"arxiv",externalId:"a",title:"Paper",summary:"Evidence",url:"https://arxiv.org/abs/a",publishedAt:"2026-10-08",importance:1,topics:[]}]};
const digest=buildWeeklyDigest(new Date("2026-10-10"),[feed]);
test("digest intro is grounded only in selected signals",async()=>{
 const intro=await digestIntro(digest,async(answer,evidence)=>{assert.deepEqual(evidence.events.map(event=>event.id),["a"]);assert.deepEqual(answer.events.map(event=>event.id),["a"]);return {summary:"A supported takeaway.",citedEventIds:["a"],claims:[]};},true);
 assert.equal(intro,"A supported takeaway.");
});
test("digest intro gracefully omits failed and foreign citations",async()=>{
 assert.equal(await digestIntro(digest,async()=>{throw new Error("model failed");},true),undefined);
 assert.equal(await digestIntro(digest,async()=>({summary:"Unrelated",citedEventIds:["foreign"],claims:[]}),true),undefined);
 assert.equal(await digestIntro(digest,async()=>{throw new Error("must not call");},false),undefined);
});
