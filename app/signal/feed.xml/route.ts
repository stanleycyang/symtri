import {listWeeklyReports} from "@/lib/data/reports";
export const revalidate=3600;
const xml=(value:string)=>value.replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[character]!));
export async function GET() {
  const reports=await listWeeklyReports();
  const body=`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Symtri Signal</title><link>https://symtri.com/signal</link><description>Useful technology developments, their evidence, and what to investigate next.</description><language>en</language><atom:link href="https://symtri.com/signal/feed.xml" rel="self" type="application/rss+xml"/><image><url>https://symtri.com/signal-icon.png</url><title>Symtri Signal</title><link>https://symtri.com/signal</link><width>144</width><height>144</height></image>${reports.map(report=>`<item><title>Symtri Signal · ${report.week}${report.headline ? ` — ${xml(report.headline)}` : ""}</title><link>https://symtri.com/signal/${report.week}</link><guid isPermaLink="true">https://symtri.com/signal/${report.week}</guid><pubDate>${new Date(report.publishedAt).toUTCString()}</pubDate><description>${xml(report.summary ?? "Read the original sources from this saved edition.")}</description></item>`).join("")}</channel></rss>`;
  return new Response(body,{headers:{"Content-Type":"application/rss+xml; charset=utf-8","Cache-Control":"public, max-age=3600, s-maxage=3600"}});
}
