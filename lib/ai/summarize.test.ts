import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { answerQuestion } from "./ask";
import { canSummarize, readingNoteFallbackModelId, readingNoteFallbackSupportModelId, readingNoteModelId, readingNoteSupportModelId, summarizeAnswer, summarizeReadingNote,validatePassages } from "./summarize";
import type { SignalEvent, SignalFeed } from "../data/model";

test("reading-note workers use their own model settings",()=>{
  const priorModel=process.env.SYMTRI_READING_NOTE_MODEL;
  const priorSupport=process.env.SYMTRI_READING_NOTE_SUPPORT_MODEL;
  const priorFallback=process.env.SYMTRI_READING_NOTE_FALLBACK_MODEL;
  const priorFallbackSupport=process.env.SYMTRI_READING_NOTE_FALLBACK_SUPPORT_MODEL;
  try {
    delete process.env.SYMTRI_READING_NOTE_MODEL;
    delete process.env.SYMTRI_READING_NOTE_SUPPORT_MODEL;
    delete process.env.SYMTRI_READING_NOTE_FALLBACK_MODEL;
    delete process.env.SYMTRI_READING_NOTE_FALLBACK_SUPPORT_MODEL;
    assert.equal(readingNoteModelId(),"alibaba/qwen3.7-flash");
    assert.equal(readingNoteSupportModelId(),"mistral/mistral-nemo");
    assert.equal(readingNoteFallbackModelId(),"alibaba/qwen3.7-flash");
    assert.equal(readingNoteFallbackSupportModelId(),"mistral/mistral-small");
    process.env.SYMTRI_READING_NOTE_MODEL="custom/draft";
    process.env.SYMTRI_READING_NOTE_SUPPORT_MODEL="custom/audit";
    process.env.SYMTRI_READING_NOTE_FALLBACK_MODEL="custom/fallback";
    process.env.SYMTRI_READING_NOTE_FALLBACK_SUPPORT_MODEL="custom/fallback-audit";
    assert.equal(readingNoteModelId(),"custom/draft");
    assert.equal(readingNoteSupportModelId(),"custom/audit");
    assert.equal(readingNoteFallbackModelId(),"custom/fallback");
    assert.equal(readingNoteFallbackSupportModelId(),"custom/fallback-audit");
  } finally {
    if(priorModel===undefined) delete process.env.SYMTRI_READING_NOTE_MODEL;
    else process.env.SYMTRI_READING_NOTE_MODEL=priorModel;
    if(priorSupport===undefined) delete process.env.SYMTRI_READING_NOTE_SUPPORT_MODEL;
    else process.env.SYMTRI_READING_NOTE_SUPPORT_MODEL=priorSupport;
    if(priorFallback===undefined) delete process.env.SYMTRI_READING_NOTE_FALLBACK_MODEL;
    else process.env.SYMTRI_READING_NOTE_FALLBACK_MODEL=priorFallback;
    if(priorFallbackSupport===undefined) delete process.env.SYMTRI_READING_NOTE_FALLBACK_SUPPORT_MODEL;
    else process.env.SYMTRI_READING_NOTE_FALLBACK_SUPPORT_MODEL=priorFallbackSupport;
  }
});

test("reading notes use low-cost independent auditors on both attempts",async()=>{
  const calls: {draft: unknown;audit:unknown}[]=[];
  const fake=(async (...args:Parameters<typeof summarizeAnswer>)=>{
    calls.push({draft:args[2],audit:args[5]});
    if(calls.length===1) throw new Error("Claim lacked a valid source passage");
    return {summary:"Supported note",claims:[],citedEventIds:[]};
  }) as typeof summarizeAnswer;
  const result=await summarizeReadingNote(answerQuestion("Explain AI agents",feed),feed,fake);
  assert.equal(result.summary,"Supported note");
  assert.deepEqual(calls,[
    {draft:"alibaba/qwen3.7-flash",audit:"mistral/mistral-nemo"},
    {draft:"alibaba/qwen3.7-flash",audit:"mistral/mistral-small"},
  ]);
});

test("reading-note fallback can use a separate inexpensive auditor",async()=>{
  const prior=process.env.SYMTRI_READING_NOTE_FALLBACK_SUPPORT_MODEL;
  const calls: {draft:unknown;audit:unknown}[]=[];
  try {
    process.env.SYMTRI_READING_NOTE_FALLBACK_SUPPORT_MODEL="custom/cheap-audit";
    const fake=(async (...args:Parameters<typeof summarizeAnswer>)=>{
      calls.push({draft:args[2],audit:args[5]});
      if(calls.length===1) throw new Error("Claim lacked a valid source passage");
      return {summary:"Supported note",claims:[],citedEventIds:[]};
    }) as typeof summarizeAnswer;
    await summarizeReadingNote(answerQuestion("Explain AI agents",feed),feed,fake);
    assert.deepEqual(calls[1],{draft:"alibaba/qwen3.7-flash",audit:"custom/cheap-audit"});
  } finally {
    if(prior===undefined) delete process.env.SYMTRI_READING_NOTE_FALLBACK_SUPPORT_MODEL;
    else process.env.SYMTRI_READING_NOTE_FALLBACK_SUPPORT_MODEL=prior;
  }
});

test("reading-note quote failures end with a verbatim attributed passage",async()=>{
  const retained={...event,evidence:{text:"The authors evaluate how AI agents use tools in a controlled test environment and describe the observed result. ".repeat(4),kind:"preprint" as const,url:event.url,attribution:"Authors",license:null,retrievedAt:feed.observedAt}};
  const retainedFeed={...feed,events:[retained]};
  const note=await summarizeReadingNote(answerQuestion("Explain AI agents",retainedFeed),retainedFeed,
    (async()=>{throw new Error("Claim lacked a valid source passage");}) as typeof summarizeAnswer);
  assert.equal(note.claims.length,1);
  assert.ok(note.claims[0].text.includes(note.claims[0].evidence[0].quote));
  const cited=retainedFeed.events.find(event=>event.id===note.citedEventIds[0]);
  assert.ok(cited?.evidence?.text.includes(note.claims[0].evidence[0].quote));
  await assert.rejects(summarizeReadingNote(answerQuestion("Explain AI agents",retainedFeed),retainedFeed,
    (async()=>{throw Object.assign(new Error("Payment required"),{statusCode:402});}) as typeof summarizeAnswer),/Payment required/);
  const noObject=await summarizeReadingNote(answerQuestion("Explain AI agents",retainedFeed),retainedFeed,
    (async()=>{const error=new Error("No object generated");error.name="AI_NoObjectGeneratedError";throw error;}) as typeof summarizeAnswer);
  assert.equal(noObject.claims.length,1);
  const badRequest=await summarizeReadingNote(answerQuestion("Explain AI agents",retainedFeed),retainedFeed,
    (async()=>{throw Object.assign(new Error("Bad model request"),{statusCode:400});}) as typeof summarizeAnswer);
  assert.equal(badRequest.claims[0].evidence[0].quote,noObject.claims[0].evidence[0].quote);
});

test("short retained abstracts do not invite unsupported model expansion",async()=>{
  const shortText="One nucleotide substitution in nucleotide 579 of HLA-C*08:22:01:01 results in a novel allele HLA-C*08:22:06.";
  assert.ok(shortText.length>=100 && shortText.length<150);
  const retained={...event,evidence:{text:shortText,kind:"abstract" as const,url:event.url,attribution:"Study authors",license:null,retrievedAt:feed.observedAt}};
  const shortFeed={...feed,events:[retained]};
  let calls=0;
  const note=await summarizeReadingNote(answerQuestion("Explain AI agents",shortFeed),shortFeed,
    (async()=>{calls++;throw new Error("Model should not run");}) as typeof summarizeAnswer);
  assert.equal(calls,0);
  assert.equal(note.claims[0].evidence[0].quote,shortText);
});

test("extractive repository notes skip navigation before an overview",async()=>{
  const text="Project title Overview • Architecture • Demo • Quick Start --- ## Project Overview The project combines a local search index with a browser interface so users can explore the saved documents. It stores the documents and exposes a query interface. ## Installation Run the installer.";
  const retained={...event,evidence:{text,kind:"repository" as const,url:event.url,attribution:"Repository authors",license:null,retrievedAt:feed.observedAt}};
  const retainedFeed={...feed,events:[retained]};
  const note=await summarizeReadingNote(answerQuestion("Explain AI agents",retainedFeed),retainedFeed,
    (async()=>{throw Object.assign(new Error("Bad model request"),{statusCode:400});}) as typeof summarizeAnswer);
  assert.ok(note.claims[0].evidence[0].quote.startsWith("The project combines"));
  assert.ok(text.includes(note.claims[0].evidence[0].quote));
});

test("numeric claims cannot borrow quantities from unquoted source text",()=>{
  const source={id:"paper",title:"A measured comparison",summary:"The phages share 89.67% genomic identity. C5 showed higher adsorption and larger plaques than N30."};
  assert.throws(()=>validatePassages([{text:"The phages share 89.67% identity and C5 showed higher adsorption.",evidence:[{sourceId:"paper",quote:"C5 showed higher adsorption and larger plaques than N30."}]}],[source]),/quantity lacked quoted support/);
  const quote="The authors evaluated 2,000 simulated scenarios.";
  assert.equal(validatePassages([{text:"The authors evaluated 2000 simulated scenarios.",evidence:[{sourceId:"paper",quote}]}],[{...source,summary:quote}]).length,1);
});

test("a limitations request cannot be answered with positive performance facts",async()=>{
  const answer=answerQuestion("What's happening with AI agents?",feed);
  const model=modelResponse({claims:[{kind:"fact",text:"The paper evaluates how AI agents use tools.",evidence:[{sourceId:event.id,quote:event.summary}]}]});
  await assert.rejects(summarizeAnswer({...answer,question:"What limitations does this source explicitly report?"},feed,model),/valid source passage/);
  assert.equal(model.doGenerateCalls.length,1);
});

const event: SignalEvent = {
  id: "arxiv:agents", source: "arxiv", externalId: "agents", title: "Agents learn to use tools",
  url: "https://arxiv.org/abs/2609.12345", summary: "A research paper evaluates tool use by AI agents.",
  publishedAt: "2026-09-22T12:00:00.000Z", importance: 60,
  topics: [{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }],
};
const feed: SignalFeed = { observedAt: "2026-09-22T13:00:00.000Z", events: [event], sources: { "hacker-news": "ok", github: "ok", arxiv: "ok", openalex: "unavailable" }, partial: false, scope: "sample" };

function modelResponse(note: unknown, supported = [true]) {
  const response = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  });
  return new MockLanguageModelV4({ doGenerate: [response(note), response({ supported })] });
}

test("a source synthesis uses only the selected evidence and validates its citations", async () => {
  const answer = answerQuestion("What is happening with AI agents?", feed);
  assert.equal(canSummarize(answer, feed), true);
  const model = modelResponse({ claims: [{ text: "A new paper evaluates how AI agents use tools.", evidence: [{ sourceId: event.id, quote: event.summary }] }] });
  const note = await summarizeAnswer(answer, feed, model);
  assert.equal(note.summary, "The cited preprint authors report: A new paper evaluates how AI agents use tools.");
  assert.deepEqual(note.citedEventIds, [event.id]);
  assert.match(JSON.stringify(model.doGenerateCalls[0].prompt), /arxiv:agents/);
});

test("unsupported citations and broader evidence do not produce a model note", async () => {
  const answer = answerQuestion("What is happening with AI agents?", feed);
  const model = modelResponse({ claims: [{ text: "A confident unsupported claim.", evidence: [{ sourceId: "not-in-the-sample", quote: event.summary }] }] });
  await assert.rejects(summarizeAnswer(answer, feed, model), /valid source passage/);
  assert.equal(canSummarize(answerQuestion("What is happening with AI robotics?", feed), feed), false);
  assert.equal(canSummarize(answerQuestion("What connects AI and energy?", feed), feed), false);
});


test("valid source IDs and exact quotes cannot bypass the support audit", async () => {
  const answer = answerQuestion("What is happening with AI agents?", feed);
  const hallucination = { claims: [{ text: "This proves agents are safe in every clinical setting.", evidence: [{ sourceId: event.id, quote: event.summary }] }] };
  await assert.rejects(summarizeAnswer(answer, feed, modelResponse(hallucination, [false])), /unsupported claim/);
  const inventedQuote = { claims: [{ text: "Agents are universally safe.", evidence: [{ sourceId: event.id, quote: "This is not a passage from the source." }] }] };
  await assert.rejects(summarizeAnswer(answer, feed, modelResponse(inventedQuote)), /valid source passage/);
});


test("source synthesis can cite retained passages beyond the display excerpt",async()=>{
  const passage="The authors report that the evaluation covers only simulated tool environments.";
  const retained={...event,evidence:{text:"Introduction. ".repeat(70)+passage,kind:"preprint" as const,url:event.url,attribution:"Authors",license:null,retrievedAt:feed.observedAt}};
  const enriched={...feed,events:[retained]};
  const model=modelResponse({claims:[{kind:"limitation",text:"The authors limit their evaluation to simulated tool environments.",evidence:[{sourceId:event.id,quote:passage}]}]});
  const note=await summarizeAnswer(answerQuestion("What is happening with AI agents?",enriched),enriched,model);
  assert.equal(note.claims[0].kind,"limitation");
  assert.ok(JSON.stringify(model.doGenerateCalls[0].prompt).includes(passage));
});


test("support audit receives cited passages without unquoted factual context",async()=>{
  const model=modelResponse({claims:[{text:"The paper evaluates AI agents using tools.",evidence:[{sourceId:event.id,quote:event.summary}]}]});
  await summarizeAnswer(answerQuestion("Explain AI agents",feed),feed,model);
  const audit=JSON.stringify(model.doGenerateCalls[1].prompt);
  assert.ok(audit.includes("sourceIdentity"));assert.ok(!audit.includes('\"summary\":'));
});
test("synthesis keeps individually supported claims and removes unsupported ones",async()=>{
  const model=modelResponse({claims:[
    {text:"The paper proves safe clinical use everywhere.",evidence:[{sourceId:event.id,quote:event.summary}]},
    {text:"The paper evaluates tool use by AI agents.",evidence:[{sourceId:event.id,quote:event.summary}]},
  ]},[false,true]);
  const note=await summarizeAnswer(answerQuestion("Explain AI agents",feed),feed,model);
  assert.equal(note.claims.length,1);assert.match(note.summary,/evaluates tool use/);
});
test("title-only discussion headlines remain discovery links during synthesis",async()=>{
  const headline={...event,id:"hacker-news:headline",source:"hacker-news",title:"Scientists establish a new universal finding",summary:"Hacker News discussion."};
  const mixed={...feed,events:[headline,event]};
  const model=modelResponse({claims:[{text:"The paper evaluates tool use by AI agents.",evidence:[{sourceId:event.id,quote:event.summary}]}]});
  await summarizeAnswer(answerQuestion("Explain AI agents",mixed),mixed,model);
  assert.ok(!JSON.stringify(model.doGenerateCalls[0].prompt).includes("hacker-news:headline"));
});

test("Ask scopes preprint update claims before auditing and displaying them",async()=>{
  const retained={...event,evidence:{text:event.summary,kind:"preprint" as const,url:event.url,attribution:"Authors",license:null,retrievedAt:feed.observedAt}};
  const enriched={...feed,events:[retained]};
  const model=modelResponse({claims:[{text:"AI agents are evaluated for tool use.",evidence:[{sourceId:event.id,quote:event.summary}]}]});
  const note=await summarizeAnswer(answerQuestion("What is happening with AI agents?",enriched),enriched,model);
  assert.match(note.summary,/^The cited preprint authors report:/);
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt),/The cited preprint authors report:/);
});

test("comparison claims are scoped to cited evaluations before support verification",async()=>{
  const coding={...event,topics:[{topicId:"ai",subtopicId:"ai-coding-agents",relevance:1}],title:"Coding agents resolve issues",summary:"The authors evaluated coding agents resolving repository issues with compact documentation.",evidence:{text:"The authors evaluated coding agents resolving repository issues with compact documentation.",kind:"preprint" as const,url:event.url,attribution:"Authors",license:null,retrievedAt:feed.observedAt}};
  const models={...coding,id:"arxiv:models",title:"Language models translate network intents",summary:"The Intent2Tc authors evaluated language models translating network intents into traffic policies.",topics:[{topicId:"ai",subtopicId:"ai-language-models",relevance:1}],evidence:{...coding.evidence,text:"The Intent2Tc authors evaluated language models translating network intents into traffic policies."}};
  const enriched={...feed,events:[coding,models]};
  const model=modelResponse({claims:[
    {text:"Coding agents resolve repository issues using compact documentation.",evidence:[{sourceId:coding.id,quote:coding.summary}]},
    {text:"Intent2Tc evaluates language models translating network intents into traffic policies.",evidence:[{sourceId:models.id,quote:models.summary}]},
  ]},[true,true]);
  const note=await summarizeAnswer(answerQuestion("Compare coding agents and language models",enriched),enriched,model);
  assert.equal(note.claims.length,2);
  assert.ok(note.claims.every(claim=>claim.text.startsWith("In the cited study's evaluation:")));
  assert.deepEqual(new Set(note.citedEventIds),new Set([coding.id,models.id]));
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt),/In the cited study's evaluation:/);
});

test("a positive finding mislabeled as a limitation still needs a task-aware audit",async()=>{
  const model=modelResponse({claims:[{kind:"limitation",text:"The authors successfully evaluate tool use by AI agents.",evidence:[{sourceId:event.id,quote:event.summary}]}]},[false]);
  await assert.rejects(summarizeAnswer({...answerQuestion("Explain AI agents",feed),question:"What limitations are explicitly reported?"},feed,model),/unsupported claim/);
  assert.equal(model.doGenerateCalls.length,2);
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt),/limitationsOnly/);
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt),/reject positive performance findings/);
});


test("unknown ransomware use cannot imply absent exploitation evidence",()=>{
  const quote="Known ransomware campaign use: Unknown. Added to the KEV catalog: 2026-05-21 (not the first disclosure date).";
  const source={id:"cisa",title:"Known exploited vulnerability",summary:quote};
  assert.throws(()=>validatePassages([{kind:"limitation",text:"Ransomware use is unknown, limiting evidence of active real-world exploitation.",evidence:[{sourceId:"cisa",quote}]}],[source]),/Unknown ransomware use/);
  assert.equal(validatePassages([{text:"The advisory reports that ransomware campaign use is unknown.",evidence:[{sourceId:"cisa",quote}]}],[source]).length,1);
});


test("an older arXiv excerpt still scopes an update as a preprint",async()=>{
  const model=modelResponse({claims:[{text:"The paper evaluates tool use by AI agents.",evidence:[{sourceId:event.id,quote:event.summary}]}]});
  const note=await summarizeAnswer(answerQuestion("What is happening with AI agents?",feed),feed,model);
  assert.match(note.summary,/^The cited preprint authors report:/);
});
