import type {WeeklyDigest} from "../data/digest";
import {evidenceCaveat,type ReportBrief} from "../data/report-editorial";
import {sourceKindLabels} from "../data/source-presentation";

const escape=(value:string)=>value.replace(/[&<>"'{}]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","{":"&#123;","}":"&#125;"}[char]!));
function link(digest:WeeklyDigest,anchor="") {
  const url=new URL(`/signal/${digest.week}`,"https://symtri.com");
  url.searchParams.set("utm_source","newsletter");url.searchParams.set("utm_medium","email");url.searchParams.set("utm_campaign",`signal-${digest.week}`);
  url.hash=anchor;return url.toString();
}
function briefContext(brief:ReportBrief,digest:WeeklyDigest) {
 if(brief.mapPath?.startsWith("/?point=")){const url=new URL(brief.mapPath,"https://symtri.com");url.searchParams.set("utm_source","newsletter");url.searchParams.set("utm_medium","email");url.searchParams.set("utm_campaign",`signal-${digest.week}`);return url.toString();}
 return link(digest,`brief-${brief.id.replace(/[^\w-]/g,"-")}`);
}
function sourceUrl(value:string) {try {const url=new URL(value);return ["https:","http:"].includes(url.protocol) ? url.href : "https://symtri.com/about";}catch{return "https://symtri.com/about";}}
export function emailDateRange(digest:WeeklyDigest) {
  const end=new Date(Date.parse(digest.end)-1);
  const start=new Date(digest.start);
  const format=(value:Date,year=false)=>value.toLocaleDateString("en-US",{month:"short",day:"numeric",...(year ? {year:"numeric" as const} : {}),timeZone:"UTC"});
  if(start.getUTCFullYear()!==end.getUTCFullYear())return `${format(start,true)} – ${format(end,true)}`;
  return `${format(start)}–${start.getUTCMonth()===end.getUTCMonth() ? end.getUTCDate() : format(end)}, ${end.getUTCFullYear()}`;
}
function audience(brief:ReportBrief) {return `For ${brief.audience.replace(/^for\s+/i,"").replace(/^./,value=>value.toLowerCase())}`;}
function briefHtml(brief:ReportBrief,digest:WeeklyDigest) {
  const primary=brief.sources[0];
  const context=briefContext(brief,digest);
  return `<h2>${escape(brief.title)}</h2><p><em>${escape(audience(brief))} · ${escape(sourceKindLabels[primary.kind].toLowerCase())}</em></p><p>${escape(brief.whatChanged.text)}</p>${brief.whyMatters ? `<p><strong>Why it matters.</strong> ${escape(brief.whyMatters.text)}</p>` : ""}<blockquote><p><strong>A useful next step</strong></p><p>${escape(brief.nextStep)}</p><p><em>Editorial suggestion</em></p></blockquote><p><strong>Keep in mind.</strong> ${escape(brief.limitation?.text ?? evidenceCaveat(primary.kind))}</p><p>${brief.sources.map((source,index)=>`<a href="${escape(sourceUrl(source.url))}">${escape(index ? `Related source: ${source.attribution}` : primary.kind==="preprint" ? "Read the preprint" : primary.kind==="repository" ? "Read the project documentation" : "Read the original source")}</a>`).join(" · ")}</p><p><a href="${escape(context)}">Explore the question: ${escape(brief.question)}</a></p>`;
}
function briefText(brief:ReportBrief,digest:WeeklyDigest) {
  return [brief.title,`${audience(brief)} · ${sourceKindLabels[brief.sources[0].kind]}`,brief.whatChanged.text,
    brief.whyMatters ? `Why it matters: ${brief.whyMatters.text}` : "",`A useful next step (editorial suggestion): ${brief.nextStep}`,
    `Keep in mind: ${brief.limitation?.text ?? evidenceCaveat(brief.sources[0].kind)}`,
    ...brief.sources.map(source=>`Original source: ${sourceUrl(source.url)}`),`Explore the question: ${brief.question}\n${briefContext(brief,digest)}`].filter(Boolean).join("\n\n");
}

/** Email is a reading surface: findings appear once, and every recommendation retains its caveat. */
export function renderWeeklyBriefing(digest:WeeklyDigest,intro?:string) {
  const editorial=digest.editorial!;
  const parts=editorial.briefs.map(brief=>briefText(brief,digest));
  if(editorial.watch)parts.push(`Worth watching\n\n${briefText(editorial.watch,digest)}`);
  const estimatedMinutes=Math.max(1,Math.ceil(parts.join(" ").split(/\s+/).length/220));
  const meta=`${emailDateRange(digest)} · ${estimatedMinutes}-minute read`;
  const lead=intro || `${editorial.briefs.length===3 ? "Three" : editorial.briefs.length} technology developments, with evidence and a next step.`;
  const coverage=`Selected from ${editorial.archiveCount.toLocaleString("en-US")} unique archived sources across ${editorial.sourceCount} feeds. Findings are grounded in retained source text; recommendations are editorial suggestions.`;
  const htmlBody=`<h1 style="font-family:Arial,sans-serif;font-size:28px;color:#152330">Symtri Signal</h1><p><em>${escape(meta)}</em></p><p>${escape(lead)}</p><hr>${editorial.briefs.map(brief=>briefHtml(brief,digest)).join("<hr>")}${editorial.watch ? `<hr><h2>Worth watching</h2><p>A source to investigate further.</p>${briefHtml(editorial.watch,digest)}` : ""}<hr><p><strong><a href="${escape(link(digest))}">Open the full briefing</a></strong></p><p>See the supporting passages, follow connections on the map, and ask about a source.</p><p><em>${escape(coverage)}</em></p><p><a href="${escape(link(digest,"coverage"))}">Sources and selection</a></p>`;
  const styledHtml=styleEmailHtml(htmlBody);
  return {
    subject:`${editorial.briefs[0].title.replace(/[{}]/g,value=>value==="{" ? "(" : ")")} · ${digest.week}`,
    preheader:editorial.briefs.map(brief=>brief.title.replace(/[{}]/g,"")).join(" · ").slice(0,180),
    text:["Symtri Signal",meta,lead,...parts,"Read the full briefing",link(digest),coverage,`Sources and selection: ${link(digest,"coverage")}`].join("\n\n"),
    html:styledHtml,
  };
}

export function styleEmailHtml(html:string):string {
 return html
    .replace(/<h1>/g,'<h1 style="font-family:Arial,sans-serif;font-size:28px;color:#152330">')
    .replace(/<p>/g,'<p style="font-family:Arial,sans-serif;font-size:16px;line-height:1.65;color:#152330;margin:16px 0">')
    .replace(/<h2>/g,'<h2 style="font-family:Arial,sans-serif;font-size:24px;line-height:1.25;color:#152330;margin:28px 0 12px">')
    .replace(/<blockquote>/g,'<blockquote style="margin:24px 0;padding:1px 20px;border-left:3px solid #246975;background-color:#eaf3f5">')
    .replace(/<hr>/g,'<hr style="border:0;border-top:1px solid #dce4e9;margin:28px 0">')
    .replace(/<a href=/g,'<a style="color:#246975;text-decoration:underline;line-height:1.75" href=');
}
