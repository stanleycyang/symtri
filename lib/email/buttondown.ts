import {personalizedButtondownBody,personalizedInbox} from "./personalization";
import {createHash} from "node:crypto";
import {renderWeeklyDigest,type WeeklyDigest} from "../data/digest";

export function buttondownBody(digest:WeeklyDigest) {
  return `<!-- buttondown-editor-mode: fancy -->${digest.personalization ? personalizedButtondownBody(digest) : renderWeeklyDigest(digest).html}`;
}

type Email={id:string;slug:string;status:string};
export type DraftResult={status:"not-configured"|"legacy-edition"|"created"|"exists";id?:string;emailStatus?:string};

/** Creates a reviewable draft only. Existing drafts and sent editions are preserved. */
export async function createButtondownDraft(digest:WeeklyDigest, options:{key?:string;fetcher?:typeof fetch}={}):Promise<DraftResult> {
  const key=options.key ?? process.env.BUTTONDOWN_API_KEY;
  if(!key)return {status:"not-configured"};
  if(!digest.editorial?.briefs.length)return {status:"legacy-edition"};
  if(!/^\d{4}-\d{2}$/.test(digest.week))throw new Error("Invalid briefing week");
  const fetcher=options.fetcher ?? fetch;
  const slug=`symtri-signal-${digest.week}`;
  const headers={Authorization:`Token ${key}`,"Content-Type":"application/json"};
  const lookup=async()=>{
    const url=new URL("https://api.buttondown.com/v1/emails");
    url.searchParams.set("subject",digest.week);
    url.searchParams.set("excluded_fields","body");
    const response=await fetcher(url,{headers,cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Buttondown lookup failed (${response.status})`);
    const data=await response.json() as {results?:Email[]};
    if(!Array.isArray(data.results))throw new Error("Invalid Buttondown email list");
    return data.results.find(email=>email.slug===slug);
  };
  const existing=await lookup();
  if(existing)return {status:"exists",id:existing.id,emailStatus:existing.status};
  const email=renderWeeklyDigest(digest);
  const inbox=digest.personalization ? personalizedInbox(digest) : {subject:email.subject,description:"preheader" in email ? email.preheader : ""};
  const response=await fetcher("https://api.buttondown.com/v1/emails",{method:"POST",cache:"no-store",signal:AbortSignal.timeout(20000),
    headers:{...headers,"X-Idempotency-Key":createHash("sha256").update(`symtri-weekly-draft:${digest.week}`).digest("hex")},
    body:JSON.stringify({subject:inbox.subject,body:buttondownBody(digest),slug,status:"draft",description:inbox.description,canonical_url:`https://symtri.com/signal/${digest.week}`})});
  if(response.status===409){const duplicate=await lookup();if(duplicate)return {status:"exists",id:duplicate.id,emailStatus:duplicate.status};}
  if(!response.ok)throw new Error(`Buttondown draft creation failed (${response.status})`);
  const created=await response.json() as Email;
  if(!created.id || created.status!=="draft")throw new Error("Buttondown did not return a draft");
  return {status:"created",id:created.id,emailStatus:created.status};
}
