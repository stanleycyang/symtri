"use client";

import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import dynamic from "next/dynamic";
import {useRouter} from "next/navigation";
const AskSymtri=dynamic(()=>import("./AskSymtri"));

function ReportAskDialog({question,signalId,subject,sourceLabels,onClose}:{question:string;signalId:string;subject:string;sourceLabels:Record<string,string>;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const router=useRouter();
  useEffect(()=>{dialog.current?.showModal();},[]);
  return createPortal(<dialog ref={dialog} className="report-ask-dialog" aria-label="Ask about this development" onCancel={event=>{event.preventDefault();onClose();}}>
    <AskSymtri open day={null} initialQuestion={/\bthis (?:source|story|paper|project)\b/i.test(question) ? question : `In this source, ${question.charAt(0).toLowerCase()}${question.slice(1)}`} signalId={signalId} subject={subject} sourceLabels={sourceLabels} onClose={onClose} onResult={()=>{}} onNavigate={(regionId,subtopicId)=>{router.push(`/?point=${encodeURIComponent(subtopicId ?? regionId)}`);}}/>
  </dialog>,document.body);
}

export default function ReportQuestion({question,signalId,subject,sourceLabels}:{question:string;signalId:string;subject:string;sourceLabels:Record<string,string>}) {
  const [open,setOpen]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null);
  const close=()=>{setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());};
  return <div className="report-follow-up"><p>Go deeper with Ask</p><button ref={trigger} type="button" onClick={()=>setOpen(true)} aria-expanded={open}>{question} <span aria-hidden="true">↗</span></button>{open && <ReportAskDialog question={question} signalId={signalId} subject={subject} sourceLabels={sourceLabels} onClose={close}/>}</div>;
}
