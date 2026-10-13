"use client";
import {useState} from "react";
import {trackEvent} from "@/lib/analytics";
import {referralUrl} from "@/lib/seo/share";
export default function ShareButton({path,title,point}: {path:string;title:string;point:string}) {
  const [status,setStatus]=useState("Share this page ↗");
  async function share() {
    const url=referralUrl(path,window.location.origin);
    try {
      let channel="clipboard";
      if(typeof navigator.share==="function") {
        try {await navigator.share({title:`${title} | SYMTRI`,url});channel="native";}
        catch(error) {if(error instanceof DOMException && error.name==="AbortError")return;await navigator.clipboard.writeText(url);}
      } else await navigator.clipboard.writeText(url);
      trackEvent("share",{point,channel});setStatus(channel==="native" ? "Shared" : "Link copied");
    } catch {setStatus("Unable to copy. Copy the address above.");}
  }
  return <div className="editorial-share"><button type="button" onClick={()=>void share()} aria-label={`Share ${title}`}>Share ↗</button><span role="status">{status}</span></div>;
}
