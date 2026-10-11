"use client";
import SourceText from "./SourceText";
import {extractivePassage,excerptDisplay} from "@/lib/data/note-presentation";
import { useEffect, useState } from "react";
import type { ReadingNote } from "@/lib/data/enrichment";

type Result={status:string;note:ReadingNote|null};
export default function StoryReading({id,summary,onAsk,onUnavailable}:{id:string;summary:string;onAsk:(question:string)=>void;onUnavailable:(id:string)=>void}) {
  const [result,setResult]=useState<Result|null>(null);
  const [failed,setFailed]=useState(false);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>{setFailed(true);controller.abort();},8000);
    fetch(`/api/story?id=${encodeURIComponent(id)}`,{signal:controller.signal}).then(async response=>{
      if (!response.ok) throw new Error("Unavailable");
      const value=await response.json() as Result;
      if (!controller.signal.aborted) {
        if (value.status !== "ready" || !value.note) { onUnavailable(id); return; }
        setResult(value);setFailed(false);
      }
    }).catch(()=>{if(!controller.signal.aborted)setFailed(true);})
      .finally(()=>clearTimeout(timer));
    return ()=>{controller.abort();clearTimeout(timer);};
  },[id,retry,onUnavailable]);
  if (!result?.note) return <div className="story-reading"><p role="status">{failed ? "This story could not load." : "Loading story…"}</p>{failed && <button type="button" onClick={()=>{setResult(null);setFailed(false);setRetry(value=>value+1);}}>RETRY</button>}</div>;
  const note=result.note;
  const excerpt=extractivePassage(note.explanation);
  const extracted=note.synthesisMethod === "extractive" || excerpt !== null;
  return <div className="story-reading">
    <h3>{extracted ? "FROM THE SOURCE" : "A CLOSER READ"}</h3>
    {extracted && <small>A shortened source excerpt, preserved in its original language.</small>}
    <SourceText text={excerpt !== null ? excerptDisplay(excerpt) : note.explanation} baseUrl={note.evidenceUrl}/>
    <a href={note.evidenceUrl} target="_blank" rel="noopener noreferrer">{note.evidenceAttribution} · Supporting source ↗</a><small>{note.evidenceLicense ?? "Reuse terms not supplied"}</small>
    <small>{extracted ? "Excerpt from the" : "Generated from the"} {note.sourceKind.replace(/-/g," ")} · {new Date(note.createdAt).toLocaleDateString()}</small>
    <details><summary>Claims and source passages</summary>{note.claims.map((claim,index)=><div className="reading-claim" key={index}><small>{(claim.kind ?? "fact").toUpperCase()}</small><SourceText text={extractivePassage(claim.text) ?? claim.text} baseUrl={note.evidenceUrl}/>{claim.evidence.map((evidence,i)=><blockquote key={i}><SourceText text={evidence.quote} baseUrl={note.evidenceUrl}/></blockquote>)}</div>)}</details>
    <details><summary>Source excerpt</summary><SourceText text={summary} baseUrl={note.evidenceUrl}/></details>
    {note.context.map(context=><details key={`${context.url}:${context.geography ?? context.revision ?? ""}`}><summary>{context.kind==="indicator" ? "IN NUMBERS" : "BACKGROUND"} · {context.title}{context.geography ? ` · ${context.geography}` : ""}</summary><SourceText text={context.text} baseUrl={context.url}/><a href={context.url} target="_blank" rel="noopener noreferrer">{context.attribution} ↗</a><small>{context.license ?? "Reuse terms not supplied"} · Retrieved {context.retrievedAt.slice(0,10)}{context.revision ? ` · Revision ${context.revision}` : ""}</small></details>)}
    <div className="reading-questions">{note.questions.map(question=><button type="button" key={question} onClick={()=>onAsk(question)}>{question} ↗</button>)}</div>
  </div>;
}
