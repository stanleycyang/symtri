import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script=fileURLToPath(new URL("../../scripts/evaluate-ask.mjs",import.meta.url));

test("production evaluation stops on a plain-text rate limit and retains its reset",async()=>{
  let requests=0;
  const server=createServer((_request,response)=>{
    requests++;
    response.writeHead(429,{"Content-Type":"text/plain","Retry-After":"90"});
    response.end("Ask limit reached");
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const directory=await mkdtemp(join(tmpdir(),"symtri-evaluation-"));
  try {
    const address=server.address();assert.ok(address && typeof address!=="string");
    const output=join(directory,"report.json");
    const child=spawn(process.execPath,[script,output],{env:{...process.env,SYMTRI_URL:`http://127.0.0.1:${address.port}`},stdio:"ignore"});
    const code=await new Promise<number|null>((resolve,reject)=>{child.on("error",reject);child.on("exit",resolve);});
    const report=JSON.parse(await readFile(output,"utf8"));
    assert.equal(code,1);assert.equal(requests,1);assert.equal(report.results.length,1);
    assert.equal(report.results[0].status,429);assert.equal(report.results[0].retryAfter,"90");
    assert.equal(report.results[0].error,"HTTP 429");
  } finally {server.close();await rm(directory,{recursive:true,force:true});}
});

test("evaluation rejects a comparison whose second subject has no visible source",async()=>{
  const server=createServer(async(request,response)=>{
    let body="";for await(const chunk of request)body+=chunk;
    const {question}=JSON.parse(body);
    const comparison=question.startsWith("Compare");
    response.writeHead(200,{"Content-Type":"application/json"});
    response.end(JSON.stringify({question,summary:"Local evaluation fixture",intent:comparison?"comparison":"update",needsClarification:true,
      events:comparison?[{id:"coding"}]:[],claims:[],
      evidenceGroups:comparison?[{subject:"coding agents",eventIds:["coding"]},{subject:"language models",eventIds:["hidden"]}]:undefined}));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const directory=await mkdtemp(join(tmpdir(),"symtri-evaluation-"));
  try {
    const address=server.address();assert.ok(address && typeof address!=="string");
    const output=join(directory,"report.json");
    const child=spawn(process.execPath,[script,output],{env:{...process.env,SYMTRI_URL:`http://127.0.0.1:${address.port}`},stdio:"ignore"});
    const code=await new Promise<number|null>((resolve,reject)=>{child.on("error",reject);child.on("exit",resolve);});
    const report=JSON.parse(await readFile(output,"utf8"));
    const comparison=report.results.find((result:{name:string})=>result.name==="comparison");
    assert.equal(comparison.checks.bothComparisonSubjects,true);
    assert.equal(comparison.checks.comparisonSourcesVisible,false);
    assert.equal(code,1);
  } finally {server.close();await rm(directory,{recursive:true,force:true});}
});
