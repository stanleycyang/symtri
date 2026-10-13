import {cache} from "react";
import type {Metadata} from "next";
import {getUniverseCatalog} from "../data/catalog";
import {getArchivedSignal, getConnectionEvents, getSnapshotFeed} from "../data/storage";
import {relationshipKey} from "../data/activity";
import {pageEvidence, pageFeed} from "./topics";
import {viewPath, type ShareView} from "./share";

export const shareCard = cache(async (point?: string, connection?: string, signal?: string, day?: string) => {
  const catalog=await getUniverseCatalog();
  let id=point;
  for(let i=0; id && i<8 && catalog.redirects?.[id]; i++) id=catalog.redirects[id];
  const region=catalog.topics.find(item=>item.id===id || item.children.some(child=>child.id===id));
  if(!region)return null;
  const child=region.children.find(item=>item.id===id);
  const other=catalog.topics.find(item=>item.id===connection && item.id!==region.id);
  const view: ShareView={point:id,connection:other?.id,signal,day};
  const feed=day && process.env.DATABASE_URL ? await getSnapshotFeed(day) : await pageFeed();
  const title=child?.name ?? region.name;
  let events=day ? (feed?.events ?? []).filter(event=>event.topics.some(match=>match.topicId===region.id && (!child || match.subtopicId===child.id))) : [];
  if(signal) {
    const event=day ? events.find(event=>event.id===signal) : process.env.DATABASE_URL ? await getArchivedSignal(signal,true) : null;
    if(event && event.topics.some(match=>match.topicId===region.id && (!child || match.subtopicId===child.id))) {
      return {name:event.title, label:`${catalog.sourceLabels[event.source] ?? event.source} / ${title}`, color:region.color,
        description:`Explore this source in SYMTRI’s ${title.toLowerCase()} map${day ? ` as saved on ${day}` : ""}.`,
        path:viewPath(view,catalog),headlines:[],stat:`SOURCE · ${event.publishedAt.slice(0,10)}`,day};
    }
    delete view.signal;
  }
  if(other) {
    if(day)events=events.filter(event=>event.topics.some(match=>match.topicId===other.id));
    else if(process.env.DATABASE_URL)events=await getConnectionEvents(region.id,other.id,false,[],true);
  } else if(!day)events=(await pageEvidence(region.id,child?.id ?? null)).events;
  const count=other ? feed?.relationships?.[relationshipKey(region.id,other.id)] : child ? feed?.childCounts?.[child.id] : feed?.activity?.[region.id]?.count;
  const momentum=!child && !other ? feed?.activity?.[region.id]?.momentum : undefined;
  const name=other ? `${region.name} × ${other.name}` : title;
  const description=other ? `Explore original sources connecting ${region.name.toLowerCase()} and ${other.name.toLowerCase()} in SYMTRI.` : `Follow recent ${name.toLowerCase()} research, projects, and news. Explore original sources and connections in SYMTRI.`;
  return {name,label:other ? "CONNECTED IDEAS" : region.name,color:region.color,description,path:viewPath(view,catalog),
    headlines:events.slice(0,3).map(event=>event.title),
    stat:count === undefined ? "EXPLORE THE SOURCES" : `${count.toLocaleString("en-US")} ${other ? "SHARED OBSERVATIONS" : "OBSERVATIONS"} · ${day ? "SAVED WINDOW" : "14 DAYS"}${momentum ? ` · ${momentum.toUpperCase()}` : ""}`,day};
});

export async function viewMetadata(view: ShareView): Promise<Metadata> {
  if(!view.point)return {};
  try {
    const card=await shareCard(view.point,view.connection,view.signal,view.day);
    if(!card)return {};
    const params=new URLSearchParams({point:view.point!,v:"2"});
    for(const key of ["connection","signal","day"] as const)if(view[key])params.set(key,view[key]);
    const image=`/api/og?${params}`;
    const title=`${card.name}${card.day ? ` · ${card.day}` : ""} | SYMTRI`;
    return {title,description:card.description,alternates:{canonical:card.path},
      ...(view.signal || view.connection || view.day ? {robots:{index:false,follow:true}} : {}),
      openGraph:{title,description:card.description,url:card.path,siteName:"SYMTRI",type:"website",images:[{url:image,width:1200,height:630,alt:title}]},
      twitter:{card:"summary_large_image",title,description:card.description,images:[{url:image,alt:title}]}};
  } catch {return {};}
}
