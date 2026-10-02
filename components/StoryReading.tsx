"use client";
import { useEffect, useState } from "react";
import type { ReadingNote } from "@/lib/data/enrichment";

type Result={status:string;note:ReadingNote|null};
export default function StoryReading({id,summary,onAsk}:{id:string;summary:string;onAsk:(question:string)=>void}) {
  const [result,setResult]=useState<Result|null>(null);
  const [failed,setFailed]=useState(false);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>{setFailed(true);controller.abort();},8000);
    fetch(`/api/story?id=${encodeURIComponent(id)}`,{signal:controller.signal}).then(async response=>{
      if (!response.ok) throw new Error("Unavailable");
      const value=await response.json() as Result;
      if (!controller.signal.aborted) {setResult(value);setFailed(false);}
    }).catch(()=>{if(!controller.signal.aborted)setFailed(true);})
      .finally(()=>clearTimeout(timer));
    return ()=>{controller.abort();clearTimeout(timer);};
  },[id,retry]);
  if (!result?.note) return <><p>{summary}</p><div className="story-reading"><p role="status">{failed ? "Reading notes are temporarily unavailable." : !result ? "Loading reading notes…" : result.status==="unavailable" ? "Reading notes are not available for this source yet." : result.status==="failed" ? "This source needs another pass before a reading note is ready." : "A source-backed reading note is being prepared."}</p>{(failed || result) && <button type="button" onClick={()=>{setResult(null);setFailed(false);setRetry(value=>value+1);}}>CHECK AGAIN</button>}</div></>;
  const note=result.note;
  return <div className="story-reading">
    <h3>A CLOSER READ</h3>
    <p>{note.explanation}</p>
    <a href={note.evidenceUrl} target="_blank" rel="noopener noreferrer">{note.evidenceAttribution} · Supporting source ↗</a><small>{note.evidenceLicense ?? "Reuse terms not supplied"}</small>
    <small>Generated from the {note.sourceKind.replace(/-/g," ")} · {new Date(note.createdAt).toLocaleDateString()}</small>
    <details><summary>Claims and source passages</summary>{note.claims.map((claim,index)=><div className="reading-claim" key={index}><small>{(claim.kind ?? "fact").toUpperCase()}</small><p>{claim.text}</p>{claim.evidence.map((evidence,i)=><blockquote key={i}>{evidence.quote}</blockquote>)}</div>)}</details>
    <details><summary>Source excerpt</summary><p>{summary}</p></details>
    {note.context.map(context=><details key={`${context.url}:${context.geography ?? context.revision ?? ""}`}><summary>{context.kind==="indicator" ? "IN NUMBERS" : "BACKGROUND"} · {context.title}{context.geography ? ` · ${context.geography}` : ""}</summary><p>{context.text}</p><a href={context.url} target="_blank" rel="noopener noreferrer">{context.attribution} ↗</a><small>{context.license ?? "Reuse terms not supplied"} · Retrieved {context.retrievedAt.slice(0,10)}{context.revision ? ` · Revision ${context.revision}` : ""}</small></details>)}
    <div className="reading-questions">{note.questions.map(question=><button type="button" key={question} onClick={()=>onAsk(question)}>{question} ↗</button>)}</div>
  </div>;
}
