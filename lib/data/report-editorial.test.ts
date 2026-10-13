import {test} from "node:test";
import assert from "node:assert/strict";
import {briefFromReadingNote,selectReportCandidates,type ReportCandidate} from "./report-editorial";
import {buildWeeklyDigest,renderWeeklyDigest} from "./digest";
import {validateReportDraft} from "../ai/report";

export function candidate(id:string,source="arxiv",region="science",importance=25):ReportCandidate {
  const text="The authors introduce a reproducible evaluation procedure for measuring the accuracy of telescope calibration under changing atmospheric conditions. The evaluation uses archived images rather than live observations.";
  const url=`https://${source}.example/${id}`;
  return {event:{id,source,externalId:id,title:`Telescope ${id} calibration`,url,summary:text,publishedAt:"2026-10-08T12:00:00Z",importance,topics:[{topicId:region,subtopicId:null,relevance:1}]},
    evidence:{text,kind:"preprint",url,attribution:"Study authors",license:null,retrievedAt:"2026-10-09T00:00:00Z"},
    note:{explanation:"The authors introduce a telescope calibration evaluation.",claims:[{text:"The authors introduce a reproducible evaluation procedure for telescope calibration.",kind:"fact",evidence:[{sourceId:id,quote:"The authors introduce a reproducible evaluation procedure"}]}],questions:["How does the telescope calibration evaluation handle atmospheric changes?"],createdAt:"2026-10-09T00:00:00Z",sourceKind:"preprint",evidenceSource:source,evidenceUrl:url,evidenceAttribution:"Study authors",evidenceLicense:null,context:[],synthesisMethod:"model"}};
}
test("report selection favors evidence and breadth over a stream of popular discussions",()=>{
  const hn=candidate("hn","hacker-news","ai",100);hn.evidence.kind="discussion";
  const papers=Array.from({length:8},(_,index)=>{const item=candidate(`paper-${index}`);item.event.title=`Finding ${index} about a distinct scientific method`;return item;});
  const project=candidate("project","github","software",100);project.event.title="A compiler for structured database migrations";project.evidence.kind="repository";
  const advisory=candidate("advisory","cisa","security");advisory.event.title="An exploited vulnerability in a network device";advisory.evidence.kind="advisory";
  const selected=selectReportCandidates([hn,...papers,project,advisory],3);
  assert.ok(!selected.includes(hn));assert.equal(new Set(selected.map(item=>item.event.source)).size,3);
});
test("duplicate links and alternate headlines do not consume multiple brief slots",()=>{
  const first=candidate("first");const other=candidate("other");other.event.url=first.event.url;
  const same=candidate("same");same.event.title=first.event.title;
  assert.equal(selectReportCandidates([first,other,same],3).length,1);
});
test("archive counts reach beyond the map sample, and one-source threads are not promoted",()=>{
  const current=Array.from({length:320},(_,index)=>({...candidate(`archive-${index}`).event,topics:[{topicId:"ai",subtopicId:"ai-agents",relevance:1}]}));
  const digest=buildWeeklyDigest(new Date("2026-10-12"),[],{current,previous:[]});
  assert.equal(digest.rising.find(item=>item.id==="ai-agents")?.count,320);
  assert.equal(digest.emerging,null);assert.equal(digest.evidenceScope,"archive");assert.equal(digest.week,"2026-41");
});
test("brief validation rejects fabricated quotations, unsupported quantities and long passages",()=>{
  const input=candidate("study");const draft={title:input.event.title,audience:"Researchers evaluating telescope calibration",whatChanged:{text:input.note.claims[0].text,passageIds:[1]},whyMatters:null,limitation:null,nextStep:"Inspect the archived-image evaluation before testing on live observations.",question:input.note.questions[0]};
  assert.equal(validateReportDraft(input,draft).method,"model");
  assert.throws(()=>validateReportDraft(input,{...draft,whatChanged:{text:"The procedure improves accuracy by 40 percent.",passageIds:[1]}}),/quantity/);
  assert.throws(()=>validateReportDraft(input,{...draft,whatChanged:{...draft.whatChanged,passageIds:[999]}}),/passage/);
  assert.throws(()=>validateReportDraft(input,{...draft,whatChanged:{...draft.whatChanged,passageIds:[0,1,2]}}),/passage/);
});
test("checked-note fallback does not invent an implication or limitation; exports carry the useful brief",()=>{
  const brief=briefFromReadingNote(candidate("source"));assert.equal(brief.whyMatters,null);assert.equal(brief.limitation,null);
  const digest=buildWeeklyDigest(new Date("2026-10-12"),[]);
  digest.editorial={version:2,briefs:[{...brief,title:"<script>Study</script>"}],watch:null,archiveCount:400,readyCount:80,sourceCount:4};
  const rendered=renderWeeklyDigest(digest);
  assert.ok(rendered.text.includes(brief.nextStep));assert.ok(rendered.text.includes("400 unique archived sources"));
  assert.ok(!rendered.html.includes("<script>"));assert.ok(rendered.html.includes("&lt;script&gt;"));
  assert.ok(!rendered.text.includes("Rising in the saved sample"));
});

test("editorial ranking keeps validated priorities ahead of diversity quotas",()=>{
  const first=candidate("first");first.event.title="A new approach to evaluating language model tool calls";
  const second=candidate("second");second.event.title="An inference engine with documented batch processing";
  const other=candidate("other","github","software");other.event.title="A game translation script";
  assert.deepEqual(selectReportCandidates([other,second,first],2,["first","second"]).map(item=>item.event.id),["first","second"]);
});

test("a brief needs a successful support audit; editorial ranking rejects invented IDs",async()=>{
  const {MockLanguageModelV4}=await import("ai/test");
  const {writeReportBrief,rankReportCandidates}=await import("../ai/report");
  const response=(value:unknown)=>({content:[{type:"text" as const,text:JSON.stringify(value)}],finishReason:{unified:"stop" as const,raw:undefined},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}},warnings:[]});
  const input=candidate("study");
  const draft={title:input.event.title,audience:"Researchers evaluating telescope calibration",whatChanged:{text:input.note.claims[0].text,passageIds:[1]},whyMatters:null,limitation:null,nextStep:"Inspect the archived-image evaluation before testing on live observations.",question:input.note.questions[0]};
  const model=new MockLanguageModelV4({doGenerate:response(draft)});
  const audit=new MockLanguageModelV4({doGenerate:response({title:false,whatChanged:false,whyMatters:false,limitation:false,nextStep:false,question:false,audience:false})});
  await assert.rejects(writeReportBrief(input,model,audit),/support audit/);
  const accepted=await writeReportBrief(input,new MockLanguageModelV4({doGenerate:response(draft)}),new MockLanguageModelV4({doGenerate:response({title:true,whatChanged:true,whyMatters:false,limitation:false,nextStep:true,question:true,audience:true})}));
  assert.equal(accepted.method,"model");assert.equal(accepted.nextStep,draft.nextStep);
  await assert.rejects(rankReportCandidates([input],new MockLanguageModelV4({doGenerate:response({orderedIds:["invented"]})})),/unknown source/);
});

test("rejecting one implication keeps the supported finding and replaces rejected recommendations",async()=>{
  const {MockLanguageModelV4}=await import("ai/test");
  const {writeReportBrief}=await import("../ai/report");
  const response=(value:unknown)=>({content:[{type:"text" as const,text:JSON.stringify(value)}],finishReason:{unified:"stop" as const,raw:undefined},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}},warnings:[]});
  const input=candidate("study");
  const draft={title:input.event.title,audience:"Researchers evaluating telescope calibration",whatChanged:{text:input.note.claims[0].text,passageIds:[1]},whyMatters:{text:"Automated evaluation eliminates the need for specialist knowledge.",passageIds:[1]},limitation:null,nextStep:"Deploy this work without additional evaluation.",question:input.note.questions[0]};
  const result=await writeReportBrief(input,new MockLanguageModelV4({doGenerate:response(draft)}),new MockLanguageModelV4({doGenerate:response({title:true,whatChanged:true,whyMatters:false,limitation:false,nextStep:false,question:true,audience:true})}));
  assert.equal(result.whatChanged.text,input.note.claims[0].text);
  assert.equal(result.whyMatters,null);
  assert.equal(result.nextStep,briefFromReadingNote(input).nextStep);
});
