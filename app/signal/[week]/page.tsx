import Link from "next/link";
import {cache} from "react";
import {notFound} from "next/navigation";
import {getWeeklyReport} from "@/lib/data/reports";
import {creator,serializeJsonLd,breadcrumbSchema} from "@/lib/seo/jsonld";
import ShareButton from "@/components/ShareButton";
import SourceLink from "@/components/SourceLink";
export const revalidate=3600;
const reportForPage=cache(async(week:string)=>{const report=await getWeeklyReport(week);if(!report)notFound();return report;});
export async function generateMetadata({params}:{params:Promise<{week:string}>}) {
  const {week}=await params;const {digest}=await reportForPage(week);
  const title=`Symtri Signal · ${week} — the week in technology`;
  const description=`Week ${week}: ${digest.signals.slice(0,2).map(event=>event.title).join(" · ")}`.slice(0,240);
  const image=`/api/og?week=${week}&v=2`;
  return {title,description,alternates:{canonical:`/signal/${week}`},openGraph:{title,description,url:`/signal/${week}`,type:"article" as const,images:[{url:image,width:1200,height:630,alt:title}]},twitter:{card:"summary_large_image" as const,title,description,images:[image]}};
}
export default async function WeeklyReport({params}:{params:Promise<{week:string}>}) {
  const {week}=await params;const report=await reportForPage(week);const {digest}=report;
  const path=`/signal/${week}`;
  const crumbs=[{name:"Home",path:"/"},{name:"Symtri Signal",path:"/signal"},{name:week,path}];
  return <main className="editorial-page"><nav aria-label="Breadcrumb">{crumbs.map(item=><Link key={item.path} href={item.path}>{item.name}</Link>)}</nav><p className="eyebrow">SYMTRI SIGNAL / {week}</p><h1>The week in technology</h1><p className="editorial-lead">{digest.start.slice(0,10)} through {new Date(Date.parse(digest.end)-1).toISOString().slice(0,10)} · A source-grounded look at the ideas observed in SYMTRI.</p><ShareButton path={path} title={`Symtri Signal · ${week}`} point={`signal-${week}`}/>
  <section><h2>Coverage at a glance</h2><p>{digest.coverage.currentDays}/7 snapshot days this week; {digest.coverage.previousDays}/7 in the comparison week. Topic growth and top signals describe saved samples. Connections compare full fourteen-day windows. Missing days and capped samples can hide activity; this is a guide to exploration.</p></section>
  <section><h2>Rising in the saved sample</h2>{digest.rising.length ? <ol className="editorial-sources">{digest.rising.map(topic=><li key={topic.id}><h3><Link href={topic.path}>{topic.name} ↗</Link></h3><p>{topic.count} observations · {topic.previous} in the prior week’s sample (+{topic.delta}).</p></li>)}</ol> : <p>No growing topics observed in the available samples.</p>}</section>
  <section><h2>New cross-region connections</h2>{digest.connections.length ? <ul>{digest.connections.map(link=><li key={link.key}><Link href={`/?point=${link.key.split(":")[0]}&connection=${link.key.split(":")[1]}&day=${digest.snapshotDay ?? new Date(Date.parse(digest.end)-86400000).toISOString().slice(0,10)}}`}>{link.key.split(":").map(id=>digest.catalog.topics.find(topic=>topic.id===id)?.name ?? id).join(" × ")} ↗</Link><p>{link.count} shared observations in the latest saved fourteen-day window. Shared subjects suggest a connection; they do not prove causation.</p></li>)}</ul> : <p>No new connections with a prior-week baseline in the available snapshots.</p>}</section>
  <section><h2>Five sources to explore</h2>{digest.signals.length ? <ol className="editorial-sources">{digest.signals.map(event=><li key={event.id}><small>{digest.catalog.sourceLabels[event.source] ?? event.source} · <time dateTime={event.publishedAt}>{event.publishedAt.slice(0,10)}</time></small><h3><SourceLink href={event.url} sourceId={event.source}>{event.title} ↗</SourceLink></h3></li>)}</ol> : <p>No matching sources in this period.</p>}</section>
  {digest.quiet && <section><h2>Quiet but growing</h2><p><Link href={digest.quiet.path}>{digest.quiet.name} ↗</Link> appeared in {digest.quiet.count} observations in this week’s saved sample, compared with {digest.quiet.previous} last week.</p></section>}
  <footer><Link href="/signal">All weekly reports</Link> · <Link href="/about">Sources and methodology</Link> · <Link href="/">Enter the universe ↗</Link></footer>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd([{"@context":"https://schema.org","@type":"Article",headline:`Symtri Signal · ${week}`,description:"A weekly report of observed technology sources and connections.",url:`https://symtri.com${path}`,image:`https://symtri.com/api/og?week=${week}&v=2`,datePublished:report.publishedAt,dateModified:report.publishedAt,author:creator},breadcrumbSchema(crumbs)])}}/>
  </main>;
}
