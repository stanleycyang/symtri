import { XMLParser } from "fast-xml-parser";
import { classifySignal } from "./classify";
import type { SignalEvent } from "./model";

function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
const namedEntities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
function decodeEntity(match: string, entity: string): string {
  if (!entity.startsWith("#")) return namedEntities[entity.toLowerCase()] ?? match;
  const hex = entity[1]?.toLowerCase() === "x";
  const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
  return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
}
function clean(value: unknown): string { return text(value).replace(/<[^>]*>/g, " ").replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, decodeEntity).replace(/\s+/g, " ").trim(); }
function safeUrl(value: unknown, fallback: string): string {
  try { const url = new URL(text(value)); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : fallback; } catch { return fallback; }
}
function iso(value: unknown): string | null { const date = new Date(typeof value === "number" ? value * 1000 : text(value)); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function short(value: string, max = 450) { return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value; }

export function normalizeHackerNews(input: unknown): SignalEvent | null {
  const item = record(input);
  if (!item || item.type !== "story" || item.deleted || item.dead) return null;
  const externalId = String(number(item.id));
  const title = clean(item.title);
  const publishedAt = iso(item.time);
  if (!title || !publishedAt || externalId === "0") return null;
  const score = number(item.score);
  const comments = number(item.descendants);
  const summary = short(clean(item.text) || "Hacker News discussion.");
  return { id: `hacker-news:${externalId}`, source: "hacker-news", externalId, title, url: safeUrl(item.url, `https://news.ycombinator.com/item?id=${externalId}`), summary, publishedAt, importance: Math.min(100, Math.log1p(score + comments * 2) * 14), topics: classifySignal(title, summary), classificationInput: { title, summary, categories: [] } };
}

export function normalizeGitHub(input: unknown): SignalEvent | null {
  const item = record(input);
  if (!item || item.private || item.archived || item.fork) return null;
  const externalId = String(number(item.id));
  const title = clean(item.full_name);
  const publishedAt = iso(item.created_at);
  const url = safeUrl(item.html_url, "");
  if (!title || !publishedAt || !url || externalId === "0") return null;
  const description = clean(item.description);
  const tags = Array.isArray(item.topics) ? item.topics.filter((tag): tag is string => typeof tag === "string").join(" ") : "";
  const summary = short(description || `Open-source repository${text(item.language) ? ` in ${text(item.language)}` : ""}.`);
  const stars = number(item.stargazers_count);
  const classificationInput = { title: `${title} ${tags}`, summary: `${summary} ${text(item.language)}`, categories: [] };
  return { id: `github:${externalId}`, source: "github", externalId, title, url, summary, publishedAt, importance: Math.min(100, Math.log1p(stars + number(item.forks_count) * 2) * 13), topics: classifySignal(classificationInput.title, classificationInput.summary), classificationInput };
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, trimValues: true });
export function normalizeArxivFeed(xml: string): SignalEvent[] {
  const feed = record(record(parser.parse(xml))?.feed);
  const entries = feed?.entry ? (Array.isArray(feed.entry) ? feed.entry : [feed.entry]) : [];
  return entries.flatMap((input): SignalEvent[] => {
    const entry = record(input);
    if (!entry) return [];
    const sourceUrl = text(entry.id);
    const externalId = sourceUrl.split("/").pop()?.replace(/v\d+$/, "") ?? "";
    const title = clean(entry.title);
    const publishedAt = iso(entry.published);
    if (!externalId || !title || !publishedAt) return [];
    const summary = short(clean(entry.summary), 600);
    const rawCategories = entry.category ? (Array.isArray(entry.category) ? entry.category : [entry.category]) : [];
    const categories = rawCategories.map((category) => text(record(category)?.["@term"])).filter(Boolean);
    return [{ id: `arxiv:${externalId}`, source: "arxiv", externalId, title, url: `https://arxiv.org/abs/${encodeURIComponent(externalId)}`, summary, publishedAt, importance: 25, topics: classifySignal(title, summary, categories), classificationInput: { title, summary, categories } }];
  });
}

export function deduplicateSignals(events: SignalEvent[]): SignalEvent[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  return [...events].sort((a, b) => b.importance - a.importance).filter((event) => {
    const canonical = canonicalSignalUrl(event.url);
    const content = signalContentKey(event);
    if (seenIds.has(event.id) || seenUrls.has(canonical) || seenContent.has(content)) return false;
    seenIds.add(event.id); seenUrls.add(canonical); seenContent.add(content); return true;
  });
}

export function uniqueSourceObservations(events: SignalEvent[]): SignalEvent[] {
  const byId = new Map<string, SignalEvent>();
  for (const event of events) {
    const previous = byId.get(event.id);
    if (!previous || event.importance > previous.importance) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function signalContentKey(event: Pick<SignalEvent, "title" | "summary">): string {
  return `${event.title}\n${event.summary}`.trim().replace(/\s+/g, " ").toLowerCase();
}

export function canonicalSignalUrl(value: string): string {
  try {
    const url = new URL(value);
    const base = `${url.host}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
    const query = url.search.slice(1).split("&").filter((part) => {
      const key = part.split("=", 1)[0].toLowerCase();
      return key && !key.startsWith("utm_") && !["ref", "ref_src", "fbclid", "gclid"].includes(key);
    }).sort().join("&");
    return query ? `${base}?${query}` : base;
  } catch {
    return value.replace(/^https?:\/\//, "").split(/[?#]/, 1)[0].replace(/\/+$/, "").toLowerCase();
  }
}
