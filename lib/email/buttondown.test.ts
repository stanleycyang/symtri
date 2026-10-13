import {test} from "node:test";
import assert from "node:assert/strict";
import {createButtondownDraft} from "./buttondown";
import type {WeeklyDigest} from "../data/digest";
import {buildWeeklyDigest} from "../data/digest";
const digest:WeeklyDigest=buildWeeklyDigest(new Date("2026-10-12T00:00:00Z"),[]);
digest.editorial={version:2,archiveCount:1,readyCount:1,sourceCount:1,briefs:[{id:"one",title:"Useful finding",audience:"builders",whatChanged:{text:"A checked finding",evidence:[]},whyMatters:null,limitation:null,nextStep:"Evaluate it",question:"What does this source report?",sources:[{id:"one",title:"Original",url:"https://example.com",publishedAt:"2026-10-06T00:00:00Z",source:"arxiv",kind:"preprint",attribution:"Authors"}],method:"reading-note"}],watch:null};
test("draft creation sends only draft status, HTML and stable idempotency key",async()=>{
  const keys:string[]=[];
  const fetcher=(async(_url,init)=>{
    if(init?.method!=="POST")return Response.json({results:[]});
    const body=JSON.parse(init.body as string);assert.equal(body.status,"draft");assert.equal(body.publish_date,undefined);assert.equal(body.slug,"symtri-signal-2026-41");assert.match(body.body,/buttondown-editor-mode: fancy/);assert.doesNotMatch(body.body,/<(?:article|section|small)[ >]/);assert.match(body.body,/Useful finding/);
    keys.push((init.headers as Record<string,string>)["X-Idempotency-Key"]);
    return Response.json({id:"draft-one",status:"draft"},{status:201});
  }) as typeof fetch;
  assert.equal((await createButtondownDraft(digest,{key:"test-key",fetcher})).status,"created");
  await createButtondownDraft(digest,{key:"test-key",fetcher});assert.equal(keys[0],keys[1]);
});
test("existing sent edition is preserved without POST",async()=>{
  let calls=0;const fetcher=(async(_url,init)=>{calls++;assert.notEqual(init?.method,"POST");return Response.json({results:[{id:"sent-one",slug:"symtri-signal-2026-41",status:"sent"}]});}) as typeof fetch;
  const result=await createButtondownDraft(digest,{key:"test-key",fetcher});assert.equal(result.emailStatus,"sent");assert.equal(calls,1);
});
test("lookup failure never creates another email or leaks provider response",async()=>{
  const fetcher=(async()=>new Response("secret test-key",{status:401})) as typeof fetch;
  await assert.rejects(createButtondownDraft(digest,{key:"test-key",fetcher}),/^Error: Buttondown lookup failed \(401\)$/);
});
test("concurrent slug collision recovers the existing draft",async()=>{
  let lookups=0;const fetcher=(async(_url,init)=>init?.method==="POST" ? new Response(null,{status:409}) : Response.json({results:++lookups===1 ? [] : [{id:"existing",slug:"symtri-signal-2026-41",status:"draft"}]})) as typeof fetch;
  assert.equal((await createButtondownDraft(digest,{key:"test-key",fetcher})).id,"existing");
});
