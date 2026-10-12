import {pointPath,topicSlug} from "../seo/paths";
import {seedCatalog} from "../universe";
import {test} from "node:test";
import assert from "node:assert/strict";
import {serializeJsonLd, datasetSchema} from "../seo/jsonld";
import {buildWeeklyDigest, renderWeeklyDigest, isoWeek} from "./digest";
import type {SignalEvent, SignalFeed} from "./model";
test("JSON-LD escapes script terminators and preserves data", () => {
 const data = datasetSchema("</script><script>alert(1)</script>","description","/ai"); const encoded = serializeJsonLd(data);
 assert.ok(!encoded.includes("<")); assert.deepEqual(JSON.parse(encoded),data);
});
test("ISO weeks handle year boundaries", () => {assert.equal(isoWeek(new Date("2021-01-01")),"2020-53");assert.equal(isoWeek(new Date("2026-10-10")),"2026-41");});
const event: SignalEvent = {id:"a",source:"arxiv",externalId:"a",title:"<script>Research</script>",url:"https://arxiv.org/abs/a",summary:"Research",publishedAt:"2026-10-08T12:00:00Z",importance:2,topics:[{topicId:"ai",subtopicId:"ai-agents",relevance:1}]};
const feed = (observedAt: string, events: SignalEvent[], relationships = {}): SignalFeed => ({observedAt,events,relationships,sources:{arxiv:"ok"},partial:false,scope:"history"});
test("digest deduplicates snapshot signals, excludes future observations, compares connections and escapes HTML", () => {
 const result = buildWeeklyDigest(new Date("2026-10-10T14:00:00Z"),[feed("2026-10-02",[],{"ai:software":1}),feed("2026-10-08",[event],{"ai:hardware":3}),feed("2026-10-09",[event],{"ai:hardware":3}),feed("2026-10-11",[{...event,id:"future"}])]);
 assert.equal(result.signals.length,1);assert.equal(result.rising.find(item=>item.id==="ai-agents")?.count,1);assert.equal(result.connections[0].key,"ai:hardware");
 const rendered = renderWeeklyDigest(result); assert.ok(!rendered.html.includes("<script>"));assert.ok(rendered.html.includes("utm_campaign=signal-2026-41"));assert.ok(rendered.text.includes(event.url));assert.equal(result.coverage.currentDays,2);
});
test("empty digest does not invent evidence", () => {const result=buildWeeklyDigest(new Date("2026-10-10"),[]);assert.deepEqual(result.signals,[]);assert.deepEqual(result.rising,[]);assert.equal(result.quiet,null);});

test("public URLs preserve generated concept IDs without a region prefix",()=>{
 const hardware=seedCatalog.topics.find(topic=>topic.id==="hardware")!;
 const catalog={...seedCatalog,topics:[{...hardware,children:[{...hardware.children[0],id:"concept-03f423627e74e4c"}]}]};
 assert.equal(pointPath("concept-03f423627e74e4c",catalog),"/hardware/concept-03f423627e74e4c");
 assert.equal(topicSlug("ai","ai-agents"),"agents");
 assert.equal(topicSlug("hardware","concept-03f423627e74e4c"),"concept-03f423627e74e4c");
});
