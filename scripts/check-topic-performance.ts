import { gzipSync } from "node:zlib";
import { INITIAL_TOPIC_PAGE_SIZE, NEXT_TOPIC_PAGE_SIZE } from "../lib/data/topic-pagination";
import type { TopicSourcePage } from "../lib/data/model";
const base = process.env.SYMTRI_SITE_URL ?? "https://symtri.com";
const region = process.env.SYMTRI_REGION ?? "software";
const child = process.env.SYMTRI_THREAD ?? (region === "software" ? "software-databases" : undefined);
const params = new URLSearchParams({ regionId: region,browse: "1",view: "list" });
if (child) params.set("childId",child);
async function sample(cursor?: string) {
  const query = new URLSearchParams(params);
  if (cursor) query.set("cursor",cursor);
  const started = performance.now();
  const response = await fetch(new URL(`/api/topic?${query}`,base),{cache:"no-store",signal:AbortSignal.timeout(20_000)});
  const ttfb = performance.now()-started;
  if (!response.ok) throw new Error(`Topic returned ${response.status}`);
  const text = await response.text();
  const page: TopicSourcePage = JSON.parse(text);
  const max = cursor ? NEXT_TOPIC_PAGE_SIZE : INITIAL_TOPIC_PAGE_SIZE;
  if (!Array.isArray(page.events) || page.events.length>max || typeof page.revision!=="string") throw new Error("Invalid list page");
  if (page.events.some(event=>"summary" in event || "classificationInput" in event || "externalId" in event)) throw new Error("List payload includes heavy detail fields");
  return {page,metrics:{rows:page.events.length,ttfbMs:Math.round(ttfb),totalMs:Math.round(performance.now()-started),bytes:Buffer.byteLength(text),estimatedGzipBytes:gzipSync(text).length}};
}
async function main() {
try {
  const samples = [];
  for(let i=0;i<3;i++) samples.push(await sample());
  const last = samples.at(-1)!;
  const next = last.page.nextCursor ? await sample(last.page.nextCursor) : null;
  if(next?.page.events.some(event=>last.page.events.some(previous=>previous.id===event.id))) throw new Error("Pages contain duplicate sources");
  console.log(JSON.stringify({region,child,firstPages:samples.map(item=>item.metrics),nextPage:next?.metrics ?? null}));
} catch(error) {
  console.error(`Topic performance check failed: ${error instanceof Error?error.message:"unknown error"}`);
  process.exitCode=1;
}

}
void main();
