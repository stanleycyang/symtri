import Link from "next/link";
import {cache} from "react";
import {notFound} from "next/navigation";
import {getWeeklyReport} from "@/lib/data/reports";
import {publisher,serializeJsonLd,breadcrumbSchema} from "@/lib/seo/jsonld";
import WeeklyReportContent from "@/components/WeeklyReport";
export const revalidate=3600;
const reportForPage=cache(async(week:string)=>{const report=await getWeeklyReport(week);if(!report)notFound();return report;});
export async function generateMetadata({params}:{params:Promise<{week:string}>}) {
  const {week}=await params;const {digest}=await reportForPage(week);
  const title=`Symtri Signal · ${week} — what matters and what to investigate`;
  const description=(digest.editorial?.briefs[0]?.whatChanged.text ?? `Week ${week}: ${digest.signals.slice(0,2).map(event=>event.title).join(" · ")}`).slice(0,240);
  const image=`/api/og?week=${week}&v=3`;
  return {title,description,alternates:{canonical:`/signal/${week}`},openGraph:{title,description,url:`/signal/${week}`,type:"article" as const,images:[{url:image,width:1200,height:630,alt:title}]},twitter:{card:"summary_large_image" as const,title,description,images:[image]}};
}
export default async function WeeklyReport({params}:{params:Promise<{week:string}>}) {
  const {week}=await params;const report=await reportForPage(week);const {digest}=report;
  const path=`/signal/${week}`;
  const crumbs=[{name:"Home",path:"/"},{name:"Symtri Signal",path:"/signal"},{name:week,path}];
  return <main className="editorial-page report-page"><nav aria-label="Breadcrumb">{crumbs.map(item=><Link key={item.path} href={item.path}>{item.name}</Link>)}</nav>
  <WeeklyReportContent digest={digest} publishedAt={report.publishedAt}/>
  <footer><Link href="/signal">All weekly reports</Link> · <Link href="/about">Sources and methodology</Link> · <Link href="/">Enter the universe ↗</Link></footer>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd([{"@context":"https://schema.org","@type":"Article",headline:`Symtri Signal · ${week}`,description:"Technology developments with supporting sources and practical follow-up questions.",url:`https://symtri.com${path}`,image:`https://symtri.com/api/og?week=${week}&v=3`,datePublished:report.publishedAt,dateModified:digest.revisedAt ?? report.publishedAt,author:publisher,publisher},breadcrumbSchema(crumbs)])}}/>
  </main>;
}
