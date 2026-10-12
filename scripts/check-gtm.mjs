import assert from "node:assert/strict";
const base = process.env.SYMTRI_CHECK_URL ?? "http://127.0.0.1:3105";
const read = async path => {const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,path);return response.text();};
const sitemap=await read("/sitemap.xml");
const locations=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>new URL(match[1]).pathname);
assert.ok(locations.length>=78,"Home, about, ten regions and 66 threads are indexed");
for(const path of locations.filter(path=>path!=="/")) {
 const html=await read(path);
 assert.match(html,/<h1[ >]/,path);
 assert.ok(html.includes(`href="https://symtri.com${path}"`),`Self canonical: ${path}`);
 assert.match(html,/application\/ld\+json/,path);
 assert.match(html,/Open in the map|Enter the universe/,path);
}
const missing=await fetch(new URL("/ai/not-a-real-thread",base));assert.equal(missing.status,404);
const linked=await read("/?point=ai-agents");assert.match(linked,/Agents — what tech is paying attention to/);assert.match(linked,/api\/og\?point=ai-agents/);
const image=await fetch(new URL("/api/og?point=ai-agents",base));assert.equal(image.status,200);assert.match(image.headers.get("content-type"),/image\/png/);assert.ok((await image.arrayBuffer()).byteLength>1000);
const signup=await fetch(new URL("/api/subscribe",base),{method:"POST"});assert.equal(signup.status,404);
console.log(`GTM smoke check passed: ${locations.length} sitemap URLs, SSR pages, canonicals, JSON-LD, unknown-topic 404, query metadata, OG PNG, and removed signup endpoint.`);
