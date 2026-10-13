import {usefulNodeCandidate} from "./selection";
export const PERSONALIZATION_VERSION=2;
import type {WeeklyDigest} from "../data/digest";
import {briefFromReadingNote,selectReportCandidates,type ReportBrief,type ReportCandidate} from "../data/report-editorial";
import {renderWeeklyBriefing,styleEmailHtml,emailDateRange} from "./weekly-template";
import {interestNodes} from "../newsletter/interests";
export type NodeEdition={id:string;name:string;regionId:string;briefs:ReportBrief[];bridge?:{brief:ReportBrief;nodes:string[]}};
export type Personalization={version:number;builtAt:string;archiveCount:number;sourceCount:number;editions:NodeEdition[]};
const escape=(value:string)=>value.replace(/[&<>"'{}]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","{":"&#123;","}":"&#125;"}[char]!));
export function buildNodeEditions(digest:WeeklyDigest,candidates:Map<string,ReportCandidate[]>,builtAt:string,archiveCount:number,sourceCount:number):Personalization {
 const nodes=interestNodes(digest.catalog);
 const contextual=(candidate:ReportCandidate,nodeId:string)=>({...briefFromReadingNote(candidate),mapPath:`/?point=${encodeURIComponent(nodeId)}&signal=${encodeURIComponent(candidate.event.id)}`});
 const editions=nodes.flatMap(node=>{
  const pool=(candidates.get(node.id) ?? []).filter(candidate=>usefulNodeCandidate(candidate,node.id));
  const selected=selectReportCandidates(pool,2);
  if(!selected.length)return [];
  const bridge=pool.find(item=>!selected.includes(item) && item.event.topics.some(match=>(match.subtopicId ?? match.topicId)!==node.id));
  const related=bridge ? [...new Set(bridge.event.topics.flatMap(match=>[match.topicId,...(match.subtopicId ? [match.subtopicId] : [])]))].filter(id=>id!==node.id && id!==node.regionId && nodes.some(item=>item.id===id)) : [];
  return [{id:node.id,name:node.name,regionId:node.regionId,briefs:selected.map(item=>contextual(item,node.id)),...(bridge && related.length ? {bridge:{brief:contextual(bridge,node.id),nodes:related}} : {})}];
 });
 return {version:PERSONALIZATION_VERSION,builtAt,archiveCount,sourceCount,editions};
}
function condition(id:string){return `subscriber.metadata.symtri_primary == "${id}"`;}
export function personalizedButtondownBody(digest:WeeklyDigest):string {
 if(!digest.personalization)return renderWeeklyBriefing(digest).html;
 const general=renderWeeklyBriefing(digest).html;
 const branches=digest.personalization.editions.map((edition,index)=>{
  const selected={...digest,editorial:{...digest.editorial!,briefs:edition.briefs,watch:null,archiveCount:digest.personalization!.archiveCount,sourceCount:digest.personalization!.sourceCount}};
  const label=`<p>Selected for your lead interest: <strong>${escape(edition.name)}</strong>. Every pick matches this node.</p><p><a href="https://symtri.com/?point=${encodeURIComponent(edition.id)}">Return to ${escape(edition.name)}</a></p>`;
  let body=renderWeeklyBriefing(selected,`Source-backed developments from ${edition.name}, with a useful next step.`).html;
  body=body.replace('<hr ',`${label}<hr `);
  if(edition.bridge){
   const connected={...selected,editorial:{...selected.editorial,briefs:[edition.bridge.brief]}};
   const bridgeHtml=renderWeeklyBriefing(connected).html;
   const start=bridgeHtml.indexOf('<h2 ');const end=bridgeHtml.lastIndexOf('<hr ');
   const conditions=edition.bridge.nodes.map(id=>`"|${id}|" in subscriber.metadata.symtri_nodes`).join(' or ');
   const names=interestNodes(digest.catalog);
   const otherName=edition.bridge.nodes.map((id,index)=>`{% ${index ? 'elif' : 'if'} "|${id}|" in subscriber.metadata.symtri_nodes %}${escape(names.find(node=>node.id===id)?.name ?? id)}`).join('')+'{% endif %}';
   const connection=`{% if ${conditions} %}<h2>A connection across your interests</h2><p>This source matches ${escape(edition.name)} and ${otherName}, two nodes you chose.</p>${bridgeHtml.slice(start,end)}{% endif %}`;
   const footer=body.lastIndexOf("<hr ");body=body.slice(0,footer)+connection+body.slice(footer);
  }
  return `{% ${index ? 'elif' : 'if'} ${condition(edition.id)} %}${body}`;
 });
 const quiet=`<h1>Symtri Signal</h1><p>${escape(emailDateRange(digest))}</p><p>No source-backed picks were selected for <strong>{{ subscriber.metadata.symtri_primary_name|escape }}</strong> in this edition. We won't substitute unrelated headlines.</p><p><a href="https://symtri.com/">Explore your node on the map</a></p><p><a href="https://symtri.com/signal/${digest.week}">Read the broader briefing</a></p>`;
 return styleEmailHtml(`${branches.join('')}${branches.length ? '{% elif subscriber.metadata.symtri_primary %}' : '{% if subscriber.metadata.symtri_primary %}'}${quiet}{% else %}${general}{% endif %}`);
}

export function personalizedInbox(digest:WeeklyDigest) {
 const ordinary=renderWeeklyBriefing(digest);
 if(!digest.personalization)return {subject:ordinary.subject,description:ordinary.preheader};
 const title=ordinary.subject.replace(/[{}]/g,character=>character==="{" ? "(" : ")");
 return {
  subject:`{% if subscriber.metadata.symtri_primary %}Your {{ subscriber.metadata.symtri_primary_name }} briefing · ${digest.week}{% else %}${title}{% endif %}`,
  // Buttondown renders subject/body conditions, but delivers description verbatim.
  description:'Useful developments, evidence and a next step. An honest update when your interests are quiet.',
 };
}
