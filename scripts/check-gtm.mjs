import assert from "node:assert/strict";
const base=process.env.SYMTRI_CHECK_URL ?? "http://127.0.0.1:3105";
const read=async path=>{const response=await fetch(new URL(path,base),{headers:{"User-Agent":"Twitterbot/1.0"},signal:AbortSignal.timeout(20000)});assert.equal(response.status,200,path);return response.text();};
const sitemap=await read("/sitemap.xml");
const locations=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>new URL(match[1]).pathname);
assert.ok(locations.length>=3,"Home, about, and weekly report archive are discoverable");
assert.equal(new Set(locations).size,locations.length,"No duplicate sitemap entries");
const titles=new Set();const descriptions=new Set();
for(const path of locations) {
 const html=await read(path);
 assert.match(html,/<h1[ >]/,path);
 const canonical=html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
 assert.equal(canonical && new URL(canonical).href,new URL(path,"https://symtri.com").href,`Self canonical: ${path}`);
 assert.match(html,/application\/ld\+json/,path);
 assert.doesNotMatch(html,/<meta name="robots" content="noindex/,path);
 const schemas=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(match=>{const data=JSON.parse(match[1]);return Array.isArray(data)?data:[data];});
 assert.ok(schemas.some(item=>item["@type"]==="WebSite"));
 const dataset=schemas.find(item=>item["@type"]==="Dataset");
 if(dataset) {
   for(const key of ["name","description","license","creator"])assert.ok(dataset[key],`${path}: Dataset ${key}`);
   assert.equal(dataset.isAccessibleForFree,true);
   assert.ok(schemas.some(item=>item["@type"]==="BreadcrumbList"));
   assert.match(html,/Open in the map/);assert.match(html,/aria-label="Share /);
 }
 const title=html.match(/<title>([^<]+)<\/title>/)?.[1];
 const description=html.match(/<meta name="description" content="([^"]+)"/)?.[1];
 assert.ok(title && !titles.has(title),`Unique title ${path}`);titles.add(title);
 assert.ok(description && !descriptions.has(description),`Unique description ${path}`);descriptions.add(description);
}
assert.equal((await fetch(new URL("/ai/not-a-real-thread",base))).status,404);
assert.equal((await fetch(new URL("/signal/9999-99",base))).status,404);
const linked=await read("/?point=ai-agents");assert.match(linked,/<title>Agents.*SYMTRI/);assert.match(linked,/api\/og\?point=ai-agents/);
const connection=await read("/?point=ai&connection=software");assert.match(connection,/Artificial Intelligence × Software/);assert.match(connection,/noindex, follow/);
assert.match(await read("/robots.txt"),/Sitemap: https:\/\/symtri.com\/sitemap.xml/);
assert.match(await read("/signal/feed.xml"),/<rss version="2.0"/);
const imagePath="/api/og?point=ai-agents&v=2";
const image=await fetch(new URL(imagePath,base));assert.equal(image.status,200);assert.match(image.headers.get("content-type"),/image\/png/);assert.ok((await image.arrayBuffer()).byteLength>1000);
const fallback=await fetch(new URL("/api/og?point=not-a-real-thread",base),{redirect:"manual"});assert.equal(fallback.status,302);assert.match(fallback.headers.get("location"),/opengraph-image.png/);
assert.equal((await fetch(new URL("/api/digest",base))).status,401);
assert.equal((await fetch(new URL("/api/subscribe",base),{method:"POST"})).status,404);
const signupPolicy=(await fetch(new URL("/",base))).headers.get("content-security-policy");
assert.match(signupPolicy ?? "",/form-action 'self' https:\/\/buttondown\.com/);
assert.match(await read("/signal"),/https:\/\/buttondown.com\/api\/emails\/embed-subscribe\/symtri/);
console.log(`GTM check passed: ${locations.length} sitemap URLs, unique metadata, SSR and schema, share previews, RSS, fallbacks, authenticated report cron, and Buttondown signup.`);
