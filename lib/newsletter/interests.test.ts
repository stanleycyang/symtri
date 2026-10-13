import {test} from "node:test";
import assert from "node:assert/strict";
import {normalizeInterests,recordNodeVisit,suggestedInterests,interestNodes,encodedInterests} from "./interests";
import {seedCatalog} from "../universe";
test("travel creates a suggestion, never a confirmed interest",()=>{
 const now=100*86400000;const state=recordNodeVisit(normalizeInterests(null,now),"ai-agents",now);
 assert.deepEqual(state.confirmed,[]);assert.deepEqual(suggestedInterests(state,interestNodes(seedCatalog),now),["ai-agents"]);
});
test("expired, future, malformed and duplicate travel is bounded",()=>{
 const now=100*86400000;const state=normalizeInterests({confirmed:["ai","ai","bad|id","software","science","space","energy","markets"],primary:"invalid",visits:[{id:"ai",at:1,count:3},{id:"software",at:now+100,count:3},{id:"space",at:now,count:1},{id:"space",at:now-1,count:2}]},now);
 assert.equal(state.confirmed.length,5);assert.equal(state.primary,"ai");assert.deepEqual(state.visits,[{id:"space",at:now,count:1}]);
});
test("confirmed nodes are excluded from suggestions and metadata keeps exact boundaries",()=>{
 const now=100*86400000;const state=normalizeInterests({confirmed:["ai-agents"],primary:"ai-agents",visits:[{id:"ai-agents",at:now,count:3}]},now);
 assert.deepEqual(suggestedInterests(state,interestNodes(seedCatalog),now),[]);assert.equal(encodedInterests(state.confirmed),"|ai-agents|");assert.ok(!encodedInterests(state.confirmed).includes("|ai|"));
});
