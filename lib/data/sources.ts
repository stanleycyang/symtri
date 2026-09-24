import { normalizeArxivFeed, normalizeGitHub, normalizeHackerNews, normalizeOpenAlex } from "./normalize";
import type { SignalEvent } from "./model";

const hackerNewsReplayLimit = 180;
const hackerNewsFreshnessLimitMs = 45 * 60 * 1000;
const hackerNewsRetryLimit = 24;
const openAlexIngestionLimit = 50;

async function request(url: string, headers?: HeadersInit, fresh = false): Promise<Response> {
  const response = await fetch(url, { headers, ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: 900 } }), signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  return response;
}

export async function fetchHackerNews(forIngestion = false): Promise<SignalEvent[]> {
  return (await fetchHackerNewsSample(forIngestion)).events;
}

export async function fetchOpenAlex(slot?: string): Promise<SignalEvent[]> {
  const hour = slot ? Date.parse(`${slot.replace(/^hour:/, "")}:00:00Z`) : Date.now();
  if (!Number.isFinite(hour)) throw new Error("Invalid OpenAlex ingestion slot");
  const from = new Date(hour - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(hour).toISOString().slice(0, 10);
  const limit = slot ? openAlexIngestionLimit : 12;
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("filter", `from_publication_date:${from},to_publication_date:${to},has_abstract:true,type:article,language:en,primary_location.source.type:journal,open_access.is_oa:true,primary_topic.field.id:17|22|31|13|21`);
  url.searchParams.set("sample", String(limit));
  url.searchParams.set("seed", slot ?? `preview:${to}`);
  url.searchParams.set("per_page", String(limit));
  url.searchParams.set("select", "id,display_name,publication_date,doi,abstract_inverted_index,is_retracted");
  const headers: Record<string, string> = { "User-Agent": "SYMTRI/0.1 (https://symtri.com)" };
  if (process.env.OPENALEX_API_KEY) headers.Authorization = `Bearer ${process.env.OPENALEX_API_KEY}`;
  const response = await request(url.toString(), headers, Boolean(slot));
  const data: unknown = await response.json();
  const items = data && typeof data === "object" && "results" in data ? data.results : null;
  if (!Array.isArray(items)) throw new Error("Invalid OpenAlex works response");
  const events = items.map(normalizeOpenAlex).filter((event): event is SignalEvent => event !== null);
  if (!events.length) throw new Error("OpenAlex returned no usable journal articles");
  return events;
}

export async function fetchHackerNewsForIngestion(): Promise<{ events: SignalEvent[]; status: "ok" | "partial" }> {
  return fetchHackerNewsSample(true);
}

async function fetchHackerNewsSample(forIngestion: boolean): Promise<{ events: SignalEvent[]; status: "ok" | "partial" }> {
  const ids: unknown = await (await request("https://hacker-news.firebaseio.com/v0/topstories.json", undefined, forIngestion)).json();
  if (!Array.isArray(ids)) throw new Error("Invalid Hacker News story list");
  const topIds = ids.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, 60);
  let storyIds = topIds;
  let newestIds: number[] = [];
  if (forIngestion) {
    const newest: unknown = await (await request("https://hacker-news.firebaseio.com/v0/newstories.json", undefined, true)).json();
    if (!Array.isArray(newest)) throw new Error("Invalid Hacker News new story list");
    newestIds = newest.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, hackerNewsReplayLimit);
    if (!newestIds.length) throw new Error("Hacker News returned no new story IDs");
    storyIds = [...new Set([...topIds, ...newestIds])];
  }
  const output: SignalEvent[] = [];
  const failedIds: number[] = [];
  const loadStory = async (id: number) => {
    const item: unknown = await (await request(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, undefined, forIngestion)).json();
    return normalizeHackerNews(item);
  };
  for (let offset = 0; offset < storyIds.length; offset += 12) {
    const ids = storyIds.slice(offset, offset + 12);
    const batch = await Promise.allSettled(ids.map(loadStory));
    batch.forEach((result, index) => {
      if (result.status === "fulfilled") { if (result.value) output.push(result.value); }
      else failedIds.push(ids[index]);
    });
  }
  let unresolved = failedIds.length;
  if (forIngestion && failedIds.length) {
    for (let offset = 0; offset < Math.min(failedIds.length, hackerNewsRetryLimit); offset += 12) {
      const batch = await Promise.allSettled(failedIds.slice(offset, offset + 12).map(loadStory));
      for (const result of batch) if (result.status === "fulfilled") {
        unresolved--;
        if (result.value) output.push(result.value);
      }
    }
    if (unresolved) console.warn("SYMTRI Hacker News items unavailable", unresolved);
  }
  if (!output.length) throw new Error("Hacker News returned no usable stories");
  if (forIngestion) {
    const newestSet = new Set(newestIds.map(String));
    const latest = Math.max(...output.filter((event) => newestSet.has(event.externalId)).map((event) => Date.parse(event.publishedAt)));
    if (!Number.isFinite(latest) || Date.now() - latest > hackerNewsFreshnessLimitMs) {
      throw new Error("Hacker News new stories are stale or unavailable");
    }
  }
  return { events: output, status: unresolved ? "partial" : "ok" };
}

async function githubRetryDelay(response: Response): Promise<number | null> {
  if (response.status !== 403 && response.status !== 429) return null;
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter * 1000) + 1000;
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) return Math.max(1000, reset * 1000 - Date.now() + 1000);
  }
  const body: unknown = await response.clone().json().catch(() => null);
  const message = body && typeof body === "object" && "message" in body ? String(body.message) : "";
  return /(?:secondary )?rate limit|abuse detection/i.test(message) ? 60_000 : null;
}

async function queryGitHub(sort: "stars" | "updated", fresh: boolean, pause: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))): Promise<SignalEvent[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `created:>=${since} stars:>=5 archived:false fork:false`);
  url.searchParams.set("sort", sort);
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "50");
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "SYMTRI/0.1", "X-GitHub-Api-Version": "2026-03-10" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const load = () => fetch(url.toString(), { headers, ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: 900 } }), signal: AbortSignal.timeout(12000) });
  let response = await load();
  if (fresh) {
    const delay = await githubRetryDelay(response);
    if (delay !== null && delay <= 65_000) { await pause(delay); response = await load(); }
  }
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  const data: unknown = await response.json();
  const items = data && typeof data === "object" && "items" in data ? data.items : null;
  if (!Array.isArray(items)) throw new Error("Invalid GitHub search response");
  return items.map(normalizeGitHub).filter((event): event is SignalEvent => event !== null);
}

export async function fetchGitHub(forIngestion = false): Promise<SignalEvent[]> {
  return forIngestion ? (await fetchGitHubForIngestion()).events : queryGitHub("stars", false);
}

export async function fetchGitHubForIngestion(pause: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))): Promise<{ events: SignalEvent[]; status: "ok" | "partial" }> {
  const popular = await queryGitHub("stars", true, pause);
  try {
    const recent = await queryGitHub("updated", true, pause);
    return { events: [...new Map([...popular, ...recent].map((event) => [event.id, event])).values()], status: "ok" };
  } catch (error) {
    console.warn("SYMTRI GitHub recent search unavailable", error instanceof Error ? error.message : "unknown error");
    return { events: popular, status: "partial" };
  }
}

const arxivPublicQuery = "cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV OR cat:cs.RO OR cat:cs.CR OR cat:cs.SE OR cat:cs.NI OR cat:astro-ph.CO OR cat:q-bio.MN OR cat:q-fin.TR OR cat:quant-ph";
const arxivIngestionQueries = [
  { query: "cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV OR cat:cs.RO", limit: 45 },
  { query: "cat:cs.CR OR cat:cs.SE OR cat:cs.NI", limit: 25 },
  { query: "cat:q-bio.BM OR cat:q-bio.MN OR cat:q-bio.GN OR cat:quant-ph", limit: 25 },
  { query: "cat:physics.ao-ph", limit: 25 },
  { query: "cat:astro-ph.CO OR cat:astro-ph.EP OR cat:astro-ph.IM", limit: 15 },
  { query: "cat:astro-ph.EP", limit: 25 },
  { query: "cat:q-fin.TR OR cat:q-fin.ST OR cat:q-fin.EC OR cat:q-fin.CP", limit: 10 },
  { query: "cat:physics.plasm-ph AND (ti:fusion OR ti:tokamak OR ti:stellarator)", limit: 25, titlePattern: /\b(?:fusion|tokamak|stellarator)s?\b/i },
] as const;

async function queryArxiv(query: string, limit: number, fresh = false): Promise<SignalEvent[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", query);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(limit));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  const xml = await (await request(url.toString(), { "User-Agent": "SYMTRI/0.1 (https://symtri.com)" }, fresh)).text();
  return normalizeArxivFeed(xml);
}

export async function fetchArxiv(forIngestion = false, pause: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))): Promise<SignalEvent[]> {
  if (!forIngestion) {
    const events = await queryArxiv(arxivPublicQuery, 55);
    if (!events.length) throw new Error("arXiv returned no usable papers");
    return events;
  }
  return (await fetchArxivForIngestion(pause)).events;
}

export async function fetchArxivForIngestion(pause: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))): Promise<{ events: SignalEvent[]; status: "ok" | "partial" }> {
  const results: SignalEvent[] = [];
  let failedGroups = 0;
  for (const [index, group] of arxivIngestionQueries.entries()) {
    // arXiv requests a three-second pause between API calls.
    if (index) await pause(3000);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const papers = await queryArxiv(group.query, group.limit, true);
        results.push(...papers.filter((paper) => !("titlePattern" in group) || group.titlePattern.test(paper.title)));
        break;
      } catch (error) {
        if (attempt === 0) { await pause(6000); continue; }
        failedGroups++;
        console.warn(`SYMTRI arXiv group ${index + 1} unavailable`, error instanceof Error ? error.message : "unknown error");
      }
    }
  }
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const events = [...new Map(results.filter((event) => Date.parse(event.publishedAt) >= cutoff)
    .map((event) => [event.id, event])).values()];
  if (!events.length) throw new Error("arXiv returned no usable papers");
  return { events, status: failedGroups ? "partial" : "ok" };
}
