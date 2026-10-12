import {ImageResponse} from "next/og";
import {pageEvidence} from "@/lib/seo/topics";
import {getUniverseCatalog} from "@/lib/data/catalog";
export const revalidate = 3600;
export async function GET(request: Request) {
  try {
    const catalog = await getUniverseCatalog();
    const point = new URL(request.url).searchParams.get("point");
    const region = catalog.topics.find(item => item.id === point || item.children.some(child => child.id === point));
    if (!region) return Response.redirect(new URL("/opengraph-image.png", request.url));
    const name = region.children.find(child => child.id === point)?.name ?? region.name;
    const child = region.children.find(item => item.id === point);
    const {events} = await pageEvidence(region.id,child?.id ?? null);
    return await renderCard(name, region.name, region.color, events.slice(0,3).map(event => event.title));
  } catch { return Response.redirect(new URL("/opengraph-image.png", request.url)); }
}
async function renderCard(name: string, regionName: string, color: string, headlines: string[]) {
    const response = new ImageResponse(<div style={{display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#101012", color: "#eeece6", width: "100%", height: "100%", padding: 72}}><div style={{fontSize: 32, color: color}}>SYMTRI / {regionName.toUpperCase()}</div><div style={{fontSize: name.length > 25 ? 58 : 80, lineHeight: 1.1}}>{name}</div><div style={{display:"flex",flexDirection:"column",gap:10,fontSize:22}}>{headlines.length ? headlines.map((title,index) => <div key={index}>{title.length > 90 ? title.slice(0,87) + "…" : title}</div>) : <div>Follow the sources. Explore the connections.</div>}</div><div style={{fontSize: 24, color: color}}>THE INTERNET IS THINKING · SYMTRI.COM</div></div>, {width: 1200, height: 630, headers: {"Cache-Control": "public, max-age=3600, s-maxage=3600"}});
    return new Response(await response.arrayBuffer(), {headers: response.headers});
}
