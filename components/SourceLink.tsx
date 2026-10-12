"use client";
import {trackEvent} from "@/lib/analytics";
export default function SourceLink({href,sourceId,children}: {href:string;sourceId:string;children:React.ReactNode}) {
 return <a href={href} target="_blank" rel="noopener noreferrer" onClick={()=>trackEvent("outbound_source",{sourceId})}>{children}</a>;
}
