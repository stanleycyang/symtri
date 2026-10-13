import {test} from "node:test";
import assert from "node:assert/strict";
import {buildWeeklyDigest,renderWeeklyDigest} from "../data/digest";
import type {ReportBrief} from "../data/report-editorial";
const brief:ReportBrief={id:"arxiv:one",title:"A useful development",audience:"builders",whatChanged:{text:"The authors report a checked finding.",evidence:[]},whyMatters:{text:"The result motivates a separate evaluation.",evidence:[]},limitation:{text:"The evaluation excludes compilation.",evidence:[]},nextStep:"Use the question below before applying it.",question:"How does this source measure performance?",sources:[{id:"arxiv:one",source:"arxiv",title:"Original paper",url:"https://example.com/paper",publishedAt:"2026-10-06T00:00:00Z",kind:"preprint",attribution:"Study authors"}],method:"reading-note"};
function fixture(){const digest=buildWeeklyDigest(new Date("2026-10-12"),[]);digest.editorial={version:2,archiveCount:100,readyCount:50,sourceCount:3,briefs:[brief],watch:null};return digest;}
test("findings appear once, with actions, caveats and a real follow-up destination",()=>{
 const email=renderWeeklyDigest(fixture());assert.equal(email.html.split(brief.whatChanged.text).length-1,1);assert.equal(email.text.split(brief.whatChanged.text).length-1,1);
 for(const value of [brief.nextStep,brief.question,brief.limitation!.text,"Editorial suggestion"])assert.ok(email.html.includes(value));
 assert.match(email.html,/#brief-arxiv-one/);assert.match(email.html,/Oct 5–11, 2026/);assert.doesNotMatch(email.html,/snapshot|160 total|iframe|<script/i);assert.ok(Buffer.byteLength(email.html)<50000);
});
test("source types and fallback caveats survive when supported implications are missing",()=>{
 const digest=fixture();digest.editorial!.briefs=[{...brief,whyMatters:null,limitation:null}];const email=renderWeeklyDigest(digest);assert.doesNotMatch(email.html,/Why it matters/);assert.match(email.html,/peer review and independent replication/);assert.match(email.html,/Read the preprint/);
});
test("untrusted source and editorial strings cannot inject email HTML or links",()=>{
 const digest=fixture();digest.editorial!.briefs=[{...brief,title:'<img src=x onerror="bad">',sources:[{...brief.sources[0],url:"javascript:bad()"}]}];const email=renderWeeklyDigest(digest);assert.doesNotMatch(email.html,/<img|javascript:/);assert.match(email.html,/&lt;img/);assert.match(email.html,/https:\/\/symtri.com\/about/);
});
test("source text cannot become a Buttondown template expression",()=>{
 const digest=fixture();digest.editorial!.briefs=[{...brief,title:"{{ subscriber.email }}",whatChanged:{text:"Literal {% if reader %} example",evidence:[]}}];
 const email=renderWeeklyDigest(digest);assert.doesNotMatch(email.html,/{{ subscriber|{% if/);assert.match(email.html,/&#123;/);
});
