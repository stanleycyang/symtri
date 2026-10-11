import assert from "node:assert/strict";
import test from "node:test";
import { evidenceFingerprint, evidenceSuitable, failurePolicy, noteFingerprint } from "./enrichment-policy";
import type { SignalEvent, SourceEvidence } from "./model";

const evidence:SourceEvidence={text:"Measured source evidence. ".repeat(12),kind:"abstract",url:"https://example.org/paper?id=1",attribution:"Authors",license:null,retrievedAt:"2026-10-10"};
const event:SignalEvent={id:"arxiv:1",source:"arxiv",externalId:"1",title:"A result",summary:"Source abstract",url:evidence.url,publishedAt:"2026-10-10",importance:1,topics:[],evidence};

test("fingerprints ignore repeat collection and whitespace but preserve content identity",()=>{
  const repeated={...evidence,text:evidence.text.replaceAll(" "," \n "),retrievedAt:"2026-10-11",url:evidence.url+"&utm_source=feed",metadata:{score:123}};
  assert.equal(evidenceFingerprint(evidence),evidenceFingerprint(repeated));
  assert.notEqual(evidenceFingerprint(evidence),evidenceFingerprint({...evidence,url:"https://example.org/paper?id=2"}));
  assert.notEqual(evidenceFingerprint(evidence),evidenceFingerprint({...evidence,text:evidence.text+"A different result."}));
  assert.notEqual(evidenceFingerprint(evidence),evidenceFingerprint({...evidence,license:"CC BY"}));
  assert.notEqual(evidenceFingerprint(evidence),evidenceFingerprint({...evidence,metadata:{dateMeaning:"last updated"}}));
  assert.notEqual(noteFingerprint(event,"arxiv"),noteFingerprint({...event,publishedAt:"2026-10-11"},"arxiv"));
  assert.notEqual(noteFingerprint(event,"arxiv"),noteFingerprint(event,"openalex"));
  assert.notEqual(noteFingerprint(event,"arxiv"),noteFingerprint({...event,title:"A different result"},"arxiv"));
});

test("evidence admission rejects thin or unattributed text before generation",()=>{
  assert.ok(evidenceSuitable(event));
  assert.ok(!evidenceSuitable({...event,evidence:{...evidence,text:"Short title"}}));
  assert.ok(!evidenceSuitable({...event,evidence:{...evidence,attribution:" "}}));
});

test("permanent failures stop; transient failures back off and exhaust",()=>{
  for(const code of ["source-too-thin","source-restricted","source-http-404","model-http-402"]) assert.ok(failurePolicy(code,1).blocked);
  assert.deepEqual(failurePolicy("source-timeout",1),{blocked:false,delaySeconds:900});
  assert.deepEqual(failurePolicy("model-http-429",2),{blocked:false,delaySeconds:3600});
  assert.ok(failurePolicy("model-http-503",3).blocked);
  assert.equal(failurePolicy("support-rejected",1).delaySeconds,21600);
});
