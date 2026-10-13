import {test} from "node:test";
import assert from "node:assert/strict";
import {buildWeeklyDigest} from "../data/digest";
import {buildNodeEditions,personalizedButtondownBody} from "./personalization";
import type {ReportCandidate} from "../data/report-editorial";
import {usefulNodeCandidate} from './selection';
function candidate(id:string):ReportCandidate {return {event:{id,source:"arxiv",externalId:id,title:`Agent evaluation ${id}`,url:`https://example.com/${id}`,summary:"Checked",publishedAt:"2026-10-06",importance:20,topics:[{topicId:"ai",subtopicId:"ai-agents",relevance:1}]},note:{explanation:"Checked",evidenceSource:"arxiv",evidenceUrl:`https://example.com/${id}`,evidenceAttribution:"Authors",evidenceLicense:null,claims:[{text:`Checked finding ${id}`,evidence:[{sourceId:id,quote:"Checked"}],kind:"fact"}],questions:["What limitations does this source report?"],createdAt:"2026-10-06",sourceKind:"preprint",context:[],synthesisMethod:"model"},evidence:{license:null,url:`https://example.com/${id}`,kind:"preprint",text:"Checked",attribution:"Authors",retrievedAt:"2026-10-06"}};}
test("exact interest branches keep niche evidence and unknown or quiet interests get no filler",()=>{
 const digest=buildWeeklyDigest(new Date("2026-10-12"),[]);const item=candidate("one");
 digest.personalization=buildNodeEditions(digest,new Map([["ai-agents",[item]]]),"2026-10-13",100,3);
 digest.editorial={version:2,briefs:digest.personalization.editions[0].briefs,watch:null,archiveCount:100,readyCount:10,sourceCount:3};
 assert.deepEqual(digest.personalization.editions.map(edition=>edition.id),["ai-agents"]);
 const body=personalizedButtondownBody(digest);assert.match(body,/symtri_primary == "ai-agents"/);assert.match(body,/No source-backed picks were selected/);assert.match(body,/symtri_primary_name\|escape/);assert.match(body,/Return to Agents/);assert.match(body,/point=ai-agents&amp;signal=one/);assert.match(body,/{% else %}/);
});
test("a bridge is conditional on another confirmed node and never substitutes the main picks",()=>{
 const digest=buildWeeklyDigest(new Date("2026-10-12"),[]);const main=[candidate("a"),candidate("b")];const bridge=candidate("c");bridge.event.topics.push({topicId:"software",subtopicId:"software-databases",relevance:1});
 digest.personalization=buildNodeEditions(digest,new Map([["ai-agents",[...main,bridge]]]),"2026-10-13",100,3);
 const edition=digest.personalization.editions[0];assert.equal(edition.briefs.length,2);assert.ok(edition.bridge);
 digest.editorial={version:2,briefs:edition.briefs,watch:null,archiveCount:100,readyCount:10,sourceCount:3};
 const body=personalizedButtondownBody(digest);assert.match(body,/"\|software-databases\|" in subscriber.metadata.symtri_nodes/);
 assert.ok(body.indexOf('A connection across your interests')<body.indexOf('Open the full briefing'));
});
test('newsletter findings reject ambiguous topic matches and broken note serialization',()=>{
 const item=candidate('fusion');item.event.title='Physics-guided data fusion for railway embankments';
 assert.equal(usefulNodeCandidate(item,'energy-fusion'),false);
 item.event.title='Tokamak plasma confinement';assert.equal(usefulNodeCandidate(item,'energy-fusion'),true);
 item.event.title='Nuclear war';assert.equal(usefulNodeCandidate(item,'energy-nuclear'),false);
 item.event.title='Nuclear fuel cycle simulator';assert.equal(usefulNodeCandidate(item,'energy-nuclear'),true);
 item.event.title='Solana token transfers';assert.equal(usefulNodeCandidate(item,'crypto-ethereum'),false);
 item.event.title='Ethereum contract deployer';assert.equal(usefulNodeCandidate(item,'crypto-ethereum'),true);
 item.note.claims[0].text='A claim. kind: fact evidence: [{';assert.equal(usefulNodeCandidate(item,'ai-agents'),false);
});
