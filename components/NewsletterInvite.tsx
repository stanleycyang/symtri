"use client";

import {useEffect,useLayoutEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {updateInterests} from "@/lib/newsletter/use-interests";
import NewsletterSignup from "./NewsletterSignup";

function SignupDialog({onClose}:{onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  return createPortal(<dialog ref={dialog} className="newsletter-dialog" aria-label="Get the weekly email" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom)onClose();}}}>
    <button className="newsletter-close" type="button" aria-label="Close email signup" onClick={onClose}>×</button>
    <NewsletterSignup placement="home"/>
  </dialog>,document.body);
}

export default function NewsletterInvite({nodeId,label="Get the weekly email",className="entrance-newsletter"}:{nodeId?:string;label?:string;className?:string}) {
  const [open,setOpen]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null);
  const wasOpen=useRef(false);
  useLayoutEffect(()=>{if(!open && wasOpen.current)trigger.current?.focus();wasOpen.current=open;},[open]);
  const close=()=>setOpen(false);
  return <><button ref={trigger} className={className} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{if(nodeId)updateInterests(prior=>({...prior,confirmed:prior.confirmed.includes(nodeId) ? prior.confirmed : [...prior.confirmed,nodeId].slice(0,5),primary:prior.primary || nodeId}));setOpen(true);}}>{label}</button>{open && <SignupDialog onClose={close}/>}</>;
}
