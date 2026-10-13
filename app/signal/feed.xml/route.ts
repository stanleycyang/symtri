import {listWeeklyReports} from "@/lib/data/reports";
export const revalidate=3600;
export async function GET() {
  const reports=await listWeeklyReports();
  const body=`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Symtri Signal</title><link>https://symtri.com/signal</link><description>Weekly sources and connections from SYMTRI’s technology map.</description><language>en</language><atom:link href="https://symtri.com/signal/feed.xml" rel="self" type="application/rss+xml"/>${reports.map(report=>`<item><title>Symtri Signal · ${report.week}</title><link>https://symtri.com/signal/${report.week}</link><guid isPermaLink="true">https://symtri.com/signal/${report.week}</guid><pubDate>${new Date(report.publishedAt).toUTCString()}</pubDate><description>A week of research, projects, rising topics, and connections. Read the report and explore the original sources.</description></item>`).join("")}</channel></rss>`;
  return new Response(body,{headers:{"Content-Type":"application/rss+xml; charset=utf-8","Cache-Control":"public, max-age=3600, s-maxage=3600"}});
}
