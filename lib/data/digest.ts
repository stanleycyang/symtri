import {pointPath} from "../seo/paths";
import type {SignalFeed} from "./model";
import {seedCatalog} from "../universe";

const DAY = 86_400_000;
export function isoWeek(date: Date): string {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const year = value.getUTCFullYear();
  const week = Math.ceil(((value.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-${String(week).padStart(2,"0")}`;
}
export function buildWeeklyDigest(weekEnd: Date, snapshots: SignalFeed[]) {
  if (!Number.isFinite(weekEnd.getTime())) throw new Error("Invalid week end");
  const end = weekEnd.getTime(); const start = end - 7 * DAY; const priorStart = start - 7 * DAY;
  const ordered = snapshots.filter(feed => Date.parse(feed.observedAt) < end && Date.parse(feed.observedAt) >= priorStart).sort((a,b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const current = ordered.filter(feed => Date.parse(feed.observedAt) >= start);
  const previous = ordered.filter(feed => Date.parse(feed.observedAt) < start);
  const unique = (feeds: SignalFeed[], from: number, to: number) => [...new Map(feeds.flatMap(feed => feed.events).filter(event => Date.parse(event.publishedAt) >= from && Date.parse(event.publishedAt) < to).map(event => [event.id,event])).values()];
  const events = unique(current, start, end); const priorEvents = unique(previous, priorStart, start);
  const catalog = current.at(-1)?.catalog ?? seedCatalog;
  // Snapshot details are capped; count only this saved sample rather than claiming full weekly coverage.
  const counts = (items: typeof events) => { const result: Record<string,number> = {}; for (const event of items) for (const id of new Set(event.topics.flatMap(match => [match.topicId, ...(match.subtopicId ? [match.subtopicId] : [])]))) result[id] = (result[id] ?? 0) + 1; return result; };
  const nowCounts = counts(events); const beforeCounts = counts(priorEvents);
  const topics = catalog.topics.flatMap(region => [{id:region.id,name:region.name,path:`/${region.id}`}, ...region.children.map(child => ({id:child.id,name:child.name,path:pointPath(child.id,catalog)!}))]);
  const growth = topics.map(topic => ({...topic,count:nowCounts[topic.id] ?? 0, previous:beforeCounts[topic.id] ?? 0, delta:(nowCounts[topic.id] ?? 0) - (beforeCounts[topic.id] ?? 0)})).filter(topic => topic.delta > 0).sort((a,b) => b.delta-a.delta || a.id.localeCompare(b.id));
  // Relationships are full-window snapshot aggregates, never reconstructed from capped details.
  const latest = current.at(-1); const baseline = previous.at(-1);
  const connections = Object.entries(latest?.relationships ?? {}).map(([key,count]) => ({key,count,delta:count-(baseline?.relationships?.[key] ?? 0),previous:baseline?.relationships?.[key] ?? 0})).filter(link => baseline && link.previous === 0 && link.count > 0).sort((a,b) => b.count-a.count || a.key.localeCompare(b.key)).slice(0,3);
  return {week:isoWeek(weekEnd), start:new Date(start).toISOString(), end:weekEnd.toISOString(), catalog, snapshotDay: latest?.observedAt.slice(0,10) ?? null, rising: growth.slice(0,5), quiet: growth.filter(topic => topic.count <= 3).at(-1) ?? null, connections, signals:events.sort((a,b) => b.importance-a.importance || b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)).slice(0,5), coverage:{currentDays: new Set(current.map(feed => feed.observedAt.slice(0,10))).size, previousDays:new Set(previous.map(feed => feed.observedAt.slice(0,10))).size}};
}
export type WeeklyDigest = ReturnType<typeof buildWeeklyDigest>;
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!)); }
export function digestLink(path: string, week: string): string {
 const url = new URL(path,"https://symtri.com"); url.searchParams.set("utm_source","newsletter"); url.searchParams.set("utm_medium","email"); url.searchParams.set("utm_campaign",`signal-${week}`); return url.toString();
}
export function renderWeeklyDigest(digest: WeeklyDigest, intro?: string) {
 const paragraphs = [intro || "A weekly look at the sources and connections observed by SYMTRI.", `Coverage: ${digest.coverage.currentDays}/7 snapshot days this week; ${digest.coverage.previousDays}/7 in the comparison week. Topic growth and top signals describe saved samples. Connections compare full fourteen-day windows.`];
 const sections = [
  {title:"Rising in the saved sample", rows:digest.rising.map(topic => ({text:`${topic.name}: ${topic.count} signals (${topic.previous} in the prior week’s sample)`,url:digestLink(topic.path,digest.week)}))},
  {title:"New cross-region connections",rows:digest.connections.map(link => ({text:`${link.key.split(":").map(id => digest.catalog.topics.find(topic => topic.id===id)?.name ?? id).join(" × ")}: ${link.count} shared sources in the latest fourteen-day window`,url:digestLink(`/?point=${link.key.split(":")[0]}&connection=${link.key.split(":")[1]}`,digest.week)}))},
  {title:"Top signals",rows:digest.signals.map(event => ({text:event.title,url:/^https?:\/\//.test(event.url) ? event.url : "https://symtri.com"}))},
  {title:"Quiet but growing", rows:digest.quiet ? [{text:`${digest.quiet.name}: ${digest.quiet.count} signals in this week’s saved sample`,url:digestLink(digest.quiet.path,digest.week)}] : []},
 ];
 return {subject:`Symtri Signal · ${digest.week}`, text:[`Symtri Signal · ${digest.week}`,...paragraphs,...sections.flatMap(section => [section.title,...(section.rows.length ? section.rows.map(row => `${row.text}\n${row.url}`) : ["No matching observations in this period."])])].join("\n\n"), html:`<article style="font-family:Arial,sans-serif;line-height:1.6;max-width:640px;margin:auto"><h1>Symtri Signal · ${digest.week}</h1>${paragraphs.map(text => `<p>${escapeHtml(text)}</p>`).join("")}${sections.map(section => `<h2>${section.title}</h2>${section.rows.length ? `<ul>${section.rows.map(row => `<li><a href="${escapeHtml(row.url)}">${escapeHtml(row.text)}</a></li>`).join("")}</ul>` : "<p>No matching observations in this period.</p>"}`).join("")}<p><a href="${escapeHtml(digestLink("/about",digest.week))}">Sources and methodology</a></p></article>`};
}
