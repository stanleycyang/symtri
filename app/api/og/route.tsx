import {ImageResponse} from "next/og";
import {shareCard} from "@/lib/seo/views";
import {getWeeklyReport} from "@/lib/data/reports";
import {parseShareView} from "@/lib/seo/share";
export const revalidate = 3600;
export async function GET(request: Request) {
  try {
    const params=new URL(request.url).searchParams;
    const view=parseShareView(params);
    const week=params.get("week");
    const report=week ? await getWeeklyReport(week) : null;
    const card=report ? {name:`What deserves your attention`,label:`Symtri Signal / ${report.week}`,color:"#d5a878",day:report.digest.start.slice(0,10),stat:report.digest.editorial ? `${report.digest.editorial.briefs.length} DEVELOPMENTS · WEEK ${report.week}` : `SAVED EDITION · WEEK ${report.week}`,headlines:report.digest.editorial?.briefs.map(brief=>brief.title) ?? report.digest.signals.slice(0,3).map(event=>event.title)} : await shareCard(view.point,view.connection,view.signal,view.day);
    if(!card)return Response.redirect(new URL("/opengraph-image.png",request.url));
    const response=renderCard(card);
    // Materialize inside the try block so rendering failures use the static card.
    return new Response(await response.arrayBuffer(),{headers:{"Content-Type":"image/png","Cache-Control":"public, max-age=3600","Vercel-CDN-Cache-Control":"public, s-maxage=3600"}});
  } catch {return Response.redirect(new URL("/opengraph-image.png",request.url));}
}

function renderCard(card:{name:string;label:string;color:string;day?:string;stat:string;headlines:string[]}) {
  return new ImageResponse(<div style={{display:"flex",flexDirection:"column",justifyContent:"space-between",background:"#101012",color:"#eeece6",width:"100%",height:"100%",padding:"52px 64px",borderTop:`8px solid ${card.color}`}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:24,color:card.color}}><span>SYMTRI / {card.label.toUpperCase().slice(0,65)}</span><span>{card.day ?? "THE INTERNET IS THINKING"}</span></div>
      <div style={{display:"flex",flexDirection:"column",gap:18}}><div style={{fontSize:card.name.length>90 ? 42 : card.name.length>35 ? 54 : 76,lineHeight:1.08,letterSpacing:-2}}>{card.name.length>180 ? card.name.slice(0,177)+"…" : card.name}</div><div style={{fontSize:21,color:card.color}}>{card.stat}</div></div>
      <div style={{display:"flex",flexDirection:"column",gap:12,fontSize:22,color:"#c8c5bf"}}>{card.headlines.length ? card.headlines.map((title,index)=><div key={index} style={{display:"flex",gap:16}}><span style={{color:card.color}}>0{index+1}</span><span>{title.length>92 ? title.slice(0,89)+"…" : title}</span></div>) : <div>Follow the sources. Explore the connections.</div>}</div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:22}}><span>EXPLORE THE MAP ↗</span><span style={{color:card.color}}>SYMTRI.COM ↗</span></div>
    </div>,{width:1200,height:630});
}
