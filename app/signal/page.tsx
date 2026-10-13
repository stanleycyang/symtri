import Link from "next/link";
import {getWeeklyReport,listWeeklyReports} from "@/lib/data/reports";
import WeeklyReportContent from "@/components/WeeklyReport";
export const revalidate=3600;
export const metadata={title:"Symtri Signal — weekly technology reports",description:"Technology developments worth your attention, their evidence, and what to investigate next.",alternates:{canonical:"/signal",types:{"application/rss+xml":"/signal/feed.xml"}},openGraph:{title:"Symtri Signal — weekly technology reports",description:"Read the evidence. Find a useful next step.",url:"/signal",images:["/opengraph-image.png"],siteName:"SYMTRI"},twitter:{card:"summary_large_image",title:"Symtri Signal — weekly technology reports",description:"Read the evidence. Find a useful next step.",images:["/opengraph-image.png"]}};
export default async function SignalArchive() {
  const reports=await listWeeklyReports();
  const latest=reports[0] ? await getWeeklyReport(reports[0].week) : null;
  return <main className="editorial-page report-page">
    <nav aria-label="Main"><Link href="/">SYMTRI ↗</Link><Link href="/about">About</Link><a href="/signal/feed.xml">RSS ↗</a></nav>
    {latest ? <WeeklyReportContent digest={latest.digest} publishedAt={latest.publishedAt}/> : <header className="report-header"><h1>Symtri Signal</h1><p className="editorial-lead">What deserves your attention. What to investigate next.</p><p>The first briefing will appear when a completed week has enough checked source evidence.</p><Link href="/">Explore current sources ↗</Link></header>}
    <section className="report-archive"><h2>Weekly editions</h2>{reports.length ? <ul>{reports.map(report=><li key={report.week}><Link href={`/signal/${report.week}`}>{report.headline ?? `Week ${report.week}`}{report.week===latest?.week ? " · Latest edition" : ""} ↗</Link><time dateTime={report.publishedAt}>{report.publishedAt.slice(0,10)}</time></li>)}</ul> : <p>New editions are published each Monday.</p>}</section>
    <footer><Link href="/">Enter the universe ↗</Link> · <a href="/signal/feed.xml">Follow via RSS ↗</a></footer>
  </main>;
}
