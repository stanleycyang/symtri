import {writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const base=process.env.SYMTRI_URL ?? "https://symtri.com";
const cases=[
  {name:"agent update",question:"What's happening with AI agents?"},
  {name:"unmapped astronomy",question:"What is new in exoplanet research?"},
  {name:"comparison",question:"Compare coding agents and language models"},
  {name:"comparison follow-up",question:"What are their limitations?",previous:"comparison"},
  {name:"civil power connection",question:"What connects nuclear energy and AI?"},
  {name:"specific archive subject",question:"What is new in battery recycling?"},
  {name:"fresh ambiguous follow-up",question:"What are their limitations?",clarify:true},
  {name:"absent subject",question:"Explain zorbital florist protocols",empty:true},
];
const results=[];
for(const item of cases){
  const previous=item.previous ? results.find(result=>result.name===item.previous)?.answer : null;
  const context=previous?{question:previous.question.slice(0,240),answer:previous.summary.slice(0,800)}:undefined;
  const started=performance.now();
  try{
    const response=await fetch(new URL("/api/ask",base),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:item.question,...(context?{context}:{})}),signal:AbortSignal.timeout(42_000)});
    const responseLatencyMs=Math.round(performance.now()-started);
    if(!response.ok){
      const result={name:item.name,question:item.question,status:response.status,latencyMs:responseLatencyMs,error:`HTTP ${response.status}`,retryAfter:response.headers.get("retry-after")};
      results.push(result);console.log(JSON.stringify(result));
      await response.body?.cancel();
      if(response.status===429) break;
      continue;
    }
    const answer=await response.json();
    const latencyMs=Math.round(performance.now()-started);
    const ids=new Set((answer.events ?? []).map(event=>event.id));
    const claims=answer.claims ?? [];
    const checks={httpSuccess:response.ok,deadline:latencyMs<40_000,
      citationsBelongToSelectedSources:claims.every(claim=>claim.evidence.length && claim.evidence.every(evidence=>ids.has(evidence.sourceId) && evidence.quote.length>=20)),
      clarification:item.clarify?answer.needsClarification===true:null,
      empty:item.empty?(answer.events?.length ?? 0)===0:null,
      comparisonSourcesVisible:answer.intent==="comparison"?answer.evidenceGroups?.every(group=>group.eventIds.some(id=>ids.has(id))):null,
      bothComparisonSubjects:answer.intent==="comparison"?answer.evidenceGroups?.length===2 && answer.evidenceGroups.every(group=>group.eventIds.length>0):null};
    results.push({name:item.name,question:item.question,status:response.status,latencyMs,checks,answer,
      manualReview:{sourceRelevance:null,claimSupport:null,usefulInformation:null,emptyAnswerCorrectness:null}});
    console.log(JSON.stringify({name:item.name,status:response.status,latencyMs,sources:ids.size,claims:claims.length,synthesis:answer.summaryKind,checks}));
  }catch(error){results.push({name:item.name,error:error.name,latencyMs:Math.round(performance.now()-started)});console.log(item.name,error.name);}
}
const output=resolve(process.argv[2] ?? `/tmp/symtri-ask-evaluation-${Date.now()}.json`);
await writeFile(output,JSON.stringify({observedAt:new Date().toISOString(),base,notes:"Mechanical checks do not establish semantic quality. Review selected sources and every claim manually.",results},null,2));
console.log(`Saved ${output}`);
if(results.some(result=>result.error || !result.checks.httpSuccess || !result.checks.deadline || result.checks.citationsBelongToSelectedSources===false || result.checks.clarification===false || result.checks.empty===false || result.checks.bothComparisonSubjects===false || result.checks.comparisonSourcesVisible===false))process.exitCode=1;
