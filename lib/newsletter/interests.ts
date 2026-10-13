import type {UniverseCatalog} from "../universe";
export const INTEREST_STORAGE_KEY="symtri:interests:v1";
export const MAX_INTERESTS=5;
export type InterestNode={id:string;name:string;region:string;regionId:string};
export type InterestState={version:1;confirmed:string[];primary:string;visits:{id:string;at:number;count:number}[]};
export function interestNodes(catalog:UniverseCatalog):InterestNode[] {
 return catalog.topics.flatMap(topic=>[{id:topic.id,name:topic.name,region:topic.name,regionId:topic.id},...topic.children.map(child=>({id:child.id,name:child.name,region:topic.name,regionId:topic.id}))]).filter(node=>/^[a-z][a-z0-9-]{0,99}$/.test(node.id));
}
export function normalizeInterests(value:unknown,now=Date.now()):InterestState {
 const raw=value && typeof value==="object" ? value as Record<string,unknown> : {};
 const valid=(id:unknown):id is string=>typeof id==="string" && /^[a-z][a-z0-9-]{0,99}$/.test(id);
 const confirmed=Array.isArray(raw.confirmed) ? [...new Set(raw.confirmed.filter(valid))].slice(0,MAX_INTERESTS) : [];
 const visits=Array.isArray(raw.visits) ? raw.visits.flatMap(item=>{
   if(!item || typeof item!=="object")return [];const v=item as Record<string,unknown>;
   return valid(v.id) && typeof v.at==="number" && v.at<=now && v.at>now-30*86400000 && typeof v.count==="number" && v.count>0 ? [{id:v.id,at:v.at,count:Math.min(20,Math.floor(v.count))}] : [];
 }).sort((a,b)=>b.at-a.at).filter((item,index,all)=>all.findIndex(v=>v.id===item.id)===index).slice(0,20) : [];
 return {version:1,confirmed,primary:valid(raw.primary) && confirmed.includes(raw.primary) ? raw.primary : confirmed[0] ?? "",visits};
}
export function recordNodeVisit(state:InterestState,id:string,now=Date.now()):InterestState {
 const previous=state.visits.find(item=>item.id===id);
 return normalizeInterests({...state,visits:[{id,at:now,count:(previous?.count ?? 0)+1},...state.visits.filter(item=>item.id!==id)]},now);
}
export function suggestedInterests(state:InterestState,nodes:InterestNode[],now=Date.now()) {
 const ids=new Set(nodes.map(node=>node.id));
 return state.visits.filter(v=>ids.has(v.id) && !state.confirmed.includes(v.id)).sort((a,b)=>(b.count*2+Math.max(0,7-(now-b.at)/86400000))-(a.count*2+Math.max(0,7-(now-a.at)/86400000))).slice(0,5).map(v=>v.id);
}
export function encodedInterests(ids:string[]) {return ids.length ? `|${ids.join("|")}|` : "";}
