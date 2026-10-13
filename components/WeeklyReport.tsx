import Link from "next/link";
import ShareButton from "./ShareButton";
import SourceLink from "./SourceLink";
import ReportQuestion from "./ReportQuestion";
import NewsletterSignup from "./NewsletterSignup";
import {evidenceCaveat, type ReportBrief} from "@/lib/data/report-editorial";
import {sourceKindLabels} from "@/lib/data/source-presentation";
import type {WeeklyDigest} from "@/lib/data/digest";
import type {GroundedClaim} from "@/lib/ai/summarize";

function ClaimEvidence({claim, brief}:{claim:GroundedClaim;brief:ReportBrief}) {
  return <details className="report-evidence"><summary>See supporting passage</summary>{claim.evidence.map((item,index)=>{
    const source=brief.sources.find(source=>source.id===item.sourceId);
    return <div key={`${item.sourceId}-${index}`}><blockquote>{item.quote}</blockquote>{source && <SourceLink href={source.url} sourceId={source.source}>{source.attribution}</SourceLink>}</div>;
  })}</details>;
}
function Brief({brief,sourceLabels,watch=false}:{brief:ReportBrief;sourceLabels:Record<string,string>;watch?:boolean}) {
  const source=brief.sources[0];
  return <article className="report-brief" id={`brief-${brief.id.replace(/[^\w-]/g,"-")}`}>
    <p className="report-audience"><span>For {brief.audience.replace(/^for\s+/i,"").replace(/^./,character=>character.toLowerCase())}</span><span className="report-kind">{sourceKindLabels[source.kind].toLowerCase()}</span></p>
    <h3>{brief.title}</h3>
    <p className="report-finding">{brief.whatChanged.text}</p>
    <ClaimEvidence claim={brief.whatChanged} brief={brief}/>
    {brief.whyMatters && <div className="report-implication"><h4>Why it matters</h4><p>{brief.whyMatters.text}</p><ClaimEvidence claim={brief.whyMatters} brief={brief}/></div>}
    <div className="report-action"><h4>{watch ? "What to investigate next" : "A useful next step"}</h4><p>{brief.nextStep}</p><small>Editorial suggestion</small></div>
    <div className="report-caveat"><h4>Keep in mind</h4><p>{brief.limitation?.text ?? evidenceCaveat(source.kind)}</p>{brief.limitation && <ClaimEvidence claim={brief.limitation} brief={brief}/>}</div>
    <ul className="report-source-links">{brief.sources.map((item,index)=><li key={item.id}><SourceLink href={item.url} sourceId={item.source}>{index ? `Related source: ${item.title}` : item.kind === "preprint" ? "Read the preprint" : item.kind === "repository" ? "Read the project documentation" : "Read the original source"} ↗</SourceLink><span>{sourceLabels[item.source] ?? item.attribution}</span></li>)}</ul>
    <ReportQuestion question={brief.question} signalId={brief.id} subject={source.title} sourceLabels={sourceLabels}/>
  </article>;
}
export function reportDateRange(digest:WeeklyDigest) {
  const last=new Date(Date.parse(digest.end)-1);
  const crossYear=new Date(digest.start).getUTCFullYear()!==last.getUTCFullYear();
  const format=(value:string)=>new Date(value).toLocaleDateString("en-US",{month:"short",day:"numeric",...(crossYear?{year:"numeric" as const}:{}),timeZone:"UTC"});
  return `${format(digest.start)}–${format(last.toISOString())}${crossYear ? "" : `, ${last.getUTCFullYear()}`}`;
}
export default function WeeklyReportContent({digest,publishedAt}:{digest:WeeklyDigest;publishedAt:string}) {
  const briefs=digest.editorial?.briefs ?? [];
  const watch=digest.editorial?.watch;
  const path=`/signal/${digest.week}`;
  return <>
    <header className="report-header"><p className="report-edition"><time dateTime={digest.start}>{reportDateRange(digest)}</time> <span>Weekly briefing</span></p><h1>Symtri Signal</h1><p>Published by <Link href="/about">SYMTRI</Link>. <a href="#coverage">Read the editorial methodology</a>.</p><p className="editorial-lead">Useful technology developments, with evidence and a next step.</p><div className="report-header-actions"><a href="#developments">Jump to the briefs</a><ShareButton path={path} title={`Symtri Signal · ${digest.week}`} point={`signal-${digest.week}`}/></div></header>
    <div className="report-layout"><aside className="report-contents" aria-label="In this edition"><p>In this edition</p><a href="#this-week">The quick read</a><a href="#developments">{briefs.length ? "The developments" : "Source reading list"}</a>{digest.emerging && <a href="#thread">A thread to investigate</a>}{watch && <a href="#watch">Worth watching</a>}<a href="#coverage">Coverage & methodology</a><a href="/signal/feed.xml">Follow via RSS ↗</a></aside>
    <div className="report-body">
      <section id="this-week" className="report-summary"><h2>The week in 60 seconds</h2>{briefs.length ? <ul>{briefs.map(brief=><li key={brief.id}><small className="report-kind">{sourceKindLabels[brief.sources[0].kind].toLowerCase()}</small><a href={`#brief-${brief.id.replace(/[^\w-]/g,"-")}`}><strong>{brief.title}</strong></a><p>{brief.whatChanged.text}</p>{brief.whyMatters && <p className="report-summary-meaning">{brief.whyMatters.text}</p>}</li>)}</ul> : <><p>This edition was saved as a source reading list. Its headlines alone do not support a useful explanation of the developments.</p><p>Read the original sources below. Future briefings select from checked source text and include practical implications and follow-up questions.</p></>}</section>
      <section id="developments"><h2>{briefs.length ? `${briefs.length === 3 ? "Three developments" : briefs.length===1 ? "One development" : "Developments"} worth your time` : "Sources from this edition"}</h2>{briefs.length ? briefs.map(brief=><Brief key={brief.id} brief={brief} sourceLabels={digest.catalog.sourceLabels}/>) : <ol className="editorial-sources">{digest.signals.map(event=><li key={event.id}><small>{digest.catalog.sourceLabels[event.source] ?? event.source} · {event.publishedAt.slice(0,10)}</small><h3><SourceLink href={event.url} sourceId={event.source}>{event.title} ↗</SourceLink></h3>{event.summary && !/^Hacker News discussion[.!]?$/i.test(event.summary) && <p>{event.summary}</p>}</li>)}</ol>}</section>
      {digest.emerging && <section id="thread" className="report-thread"><h2>A thread to investigate</h2><h3><Link href={digest.emerging.path}>{digest.emerging.name}</Link></h3><p>{digest.emerging.count} archived sources this week, compared with {digest.emerging.previous} last week. These sources share a classified subject; read them together to assess whether the connection is useful.</p><ul>{digest.emerging.evidence.map(event=><li key={event.id}><SourceLink href={event.url} sourceId={event.source}>{event.title} ↗</SourceLink></li>)}</ul><Link href={digest.emerging.path}>Explore this thread ↗</Link></section>}
      {watch && <section id="watch"><h2>Worth watching</h2><p className="report-section-intro">Another source worth investigating. Treat its claims as a starting point for evaluation.</p><Brief brief={watch} sourceLabels={digest.catalog.sourceLabels} watch/></section>}
      <NewsletterSignup week={digest.week}/>
      <section id="coverage" className="report-methodology"><h2>Coverage & methodology</h2>{digest.editorial ? <p>Selected from {digest.editorial.archiveCount.toLocaleString("en-US")} unique archived sources published during this UTC week, across {digest.editorial.sourceCount} connected feeds. {digest.editorial.readyCount.toLocaleString("en-US")} had published reading notes. Selection examines up to 16 notes per evidence feed, sampled across the week (160 in total) and requires matching retained source text. </p> : <p>This edition uses capped daily snapshot samples. Its saved observations do not represent the full weekly archive.</p>}<p>Selection favors concrete usefulness to people building technology, readable evidence, and distinct developments. An editorial ranking uses the checked findings when synthesis is available; otherwise selection falls back to evidence quality and source variety. Engagement helps find candidates within each feed; it is not a measure of scientific or practical importance. A weekly briefing is a curated starting point, not a complete account of technology.</p>{briefs.length>0 && <p>Briefs reuse checked reading notes{briefs.some(brief=>brief.method==="model") ? " and model-written explanations checked against retained source passages" : ""}. Recommendations are editorial suggestions. Source-type caveats describe the evidence available here; they are not findings reported by the authors.</p>}<p>{digest.coverage.currentDays}/7 saved snapshot days this week and {digest.coverage.previousDays}/7 in the prior week. Snapshot availability is separate from archive coverage; missing observations and unavailable feeds can hide developments.</p><p>{digest.revisedAt ? "Edition published" : "Published"} <time dateTime={publishedAt}>{new Date(publishedAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"})}</time>.{digest.revisedAt && <> Briefing updated <time dateTime={digest.revisedAt}>{new Date(digest.revisedAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"})}</time>.</>} <Link href="/about">Sources and methodology ↗</Link></p></section>
    </div></div>
  </>;
}
