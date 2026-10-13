"use client";

import {useEffect,useId,useMemo,useState} from "react";
import {seedCatalog} from "@/lib/universe";
import {interestNodes,suggestedInterests,encodedInterests,MAX_INTERESTS,type InterestNode} from "@/lib/newsletter/interests";
import {useInterests,updateInterests} from "@/lib/newsletter/use-interests";
import {trackEvent} from "@/lib/analytics";

export default function NewsletterSignup({week,placement="report"}:{week?:string;placement?:"report"|"home"}) {
  const id=useId();
  const state=useInterests();
  const [nodes,setNodes]=useState<InterestNode[]>(()=>interestNodes(seedCatalog));
  const [query,setQuery]=useState("");
  const [catalogFailed,setCatalogFailed]=useState(false);
  useEffect(()=>{const controller=new AbortController();fetch("/api/interests",{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error();const data=await response.json();if(Array.isArray(data.nodes))setNodes(data.nodes);}).catch(()=>{if(!controller.signal.aborted)setCatalogFailed(true);});return ()=>controller.abort();},[]);
  const chosen=useMemo(()=>state.confirmed.filter(node=>nodes.some(item=>item.id===node)),[state.confirmed,nodes]);
  const primary=chosen.includes(state.primary) ? state.primary : chosen[0] ?? "";
  const suggestions=suggestedInterests(state,nodes);
  const matches=query.trim().length>=2 ? nodes.filter(node=>`${node.name} ${node.region}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0,8) : nodes.filter(node=>node.id===node.regionId);
  const toggle=(node:string)=>updateInterests(prior=>{const valid=prior.confirmed.filter(value=>nodes.some(item=>item.id===value));const confirmed=valid.includes(node) ? valid.filter(value=>value!==node) : valid.length<MAX_INTERESTS ? [...valid,node] : valid;return {...prior,confirmed,primary:confirmed.includes(prior.primary) ? prior.primary : confirmed[0] ?? ""};});
  return <section id={placement==="report" ? "subscribe" : undefined} className="report-newsletter" aria-labelledby={`${id}-title`}>
    <p className="report-edition">Keep up without keeping tabs</p>
    <h2 id={`${id}-title`}>Get next week’s briefing</h2>
    <p>Useful developments from the nodes you care about, with evidence and a next step. Delivered weekly.</p>
    <form action="https://buttondown.com/api/emails/embed-subscribe/symtri" method="post" onSubmit={()=>trackEvent("newsletter_signup",{point:placement==="home" ? "home" : `signal-${week}`,channel:"buttondown"})}>
      <label htmlFor={`${id}-email`}>Email address</label><div><input id={`${id}-email`} type="email" name="email" autoComplete="email" placeholder="you@example.com" required/></div>
      <fieldset className="newsletter-interests"><legend>What should we keep you updated on?</legend>
        <p>Choose up to five nodes, or leave this empty for the broader briefing.</p>
        {chosen.length>0 && <div className="interest-chips" aria-label="Your interests">{chosen.map(node=><button type="button" key={node} aria-label={`Remove ${nodes.find(item=>item.id===node)?.name}`} onClick={()=>toggle(node)}>{nodes.find(item=>item.id===node)?.name} ×</button>)}</div>}
        {suggestions.length>0 && <div className="interest-suggestions"><span>From your recent exploring — suggestions only</span><div className="interest-chips">{suggestions.map(node=><button type="button" key={node} disabled={chosen.length>=MAX_INTERESTS} onClick={()=>toggle(node)}>+ {nodes.find(item=>item.id===node)?.name}</button>)}</div></div>}
        <label htmlFor={`${id}-search`}>Find a node</label><input id={`${id}-search`} type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Agents, databases, climate…" autoComplete="off"/>
        <div className="interest-options" aria-label="Available nodes">{matches.map(node=><button type="button" key={node.id} aria-pressed={chosen.includes(node.id)} disabled={!chosen.includes(node.id) && chosen.length>=MAX_INTERESTS} onClick={()=>toggle(node.id)}>{node.name}{node.id!==node.regionId && <small>{node.region}</small>}</button>)}</div>
        {query && !matches.length && <p role="status">No matching node. Try another subject.</p>}
        {catalogFailed && <p role="status">Showing the core map nodes while the current catalog is unavailable.</p>}
        {chosen.length>1 && <><label htmlFor={`${id}-primary`}>Lead my briefing with</label><select id={`${id}-primary`} value={primary} onChange={event=>{const value=event.target.value;updateInterests(prior=>({...prior,primary:value}));}}>{chosen.map(node=><option key={node} value={node}>{nodes.find(item=>item.id===node)?.name}</option>)}</select></>}
        <small>Your confirmed choices are sent to Buttondown when you subscribe. Browsing alone never changes your email interests.</small>
      </fieldset>
      <input type="hidden" name="metadata__symtri_nodes" value={encodedInterests(chosen)}/>
      <input type="hidden" name="metadata__symtri_primary" value={primary}/>
      <input type="hidden" name="metadata__symtri_primary_name" value={nodes.find(node=>node.id===primary)?.name ?? ""}/>
      <button className="newsletter-submit" type="submit">Subscribe</button>
      <input type="hidden" name="embed" value="1"/>
    </form>
    <small>Confirm your subscription with Buttondown. Unsubscribe anytime.</small>
  </section>;
}
