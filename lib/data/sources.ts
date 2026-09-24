import { normalizeArxivFeed, normalizeGitHub, normalizeHackerNews } from "./normalize";
import type { SignalEvent } from "./model";

async function request(url: string, headers?: HeadersInit): Promise<Response> {
  const response = await fetch(url, { headers, next: { revalidate: 900 }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  return response;
}

export async function fetchHackerNews(forIngestion = false): Promise<SignalEvent[]> {
  const ids: unknown = await (await request("https://hacker-news.firebaseio.com/v0/topstories.json")).json();
  if (!Array.isArray(ids)) throw new Error("Invalid Hacker News story list");
  const topIds = ids.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, 60);
  let storyIds = topIds;
  if (forIngestion) {
    try {
      const newest: unknown = await (await request("https://hacker-news.firebaseio.com/v0/newstories.json")).json();
      if (!Array.isArray(newest)) throw new Error("Invalid Hacker News new story list");
      storyIds = [...new Set([...topIds, ...newest.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, 60)])];
    } catch (error) {
      console.warn("SYMTRI Hacker News new stories unavailable", error instanceof Error ? error.message : "unknown error");
    }
  }
  const output: SignalEvent[] = [];
  for (let offset = 0; offset < storyIds.length; offset += 12) {
    const batch = await Promise.allSettled(storyIds.slice(offset, offset + 12).map(async (id) => {
      const item: unknown = await (await request(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json();
      return normalizeHackerNews(item);
    }));
    for (const result of batch) if (result.status === "fulfilled" && result.value) output.push(result.value);
  }
  if (!output.length) throw new Error("Hacker News returned no usable stories");
  return output;
}

export async function fetchGitHub(forIngestion = false): Promise<SignalEvent[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `created:>=${since} stars:>=5 archived:false fork:false`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "50");
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "SYMTRI/0.1", "X-GitHub-Api-Version": "2026-03-10" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  async function search(searchUrl: URL): Promise<SignalEvent[]> {
    const data: unknown = await (await request(searchUrl.toString(), headers)).json();
    const items = data && typeof data === "object" && "items" in data ? data.items : null;
    if (!Array.isArray(items)) throw new Error("Invalid GitHub search response");
    return items.map(normalizeGitHub).filter((event): event is SignalEvent => event !== null);
  }
  const popular = await search(url);
  if (!forIngestion) return popular;
  try {
    const recentUrl = new URL(url);
    recentUrl.searchParams.set("sort", "updated");
    const recent = await search(recentUrl);
    return [...new Map([...popular, ...recent].map((event) => [event.id, event])).values()];
  } catch (error) {
    console.warn("SYMTRI GitHub recent search unavailable", error instanceof Error ? error.message : "unknown error");
    return popular;
  }
}

export async function fetchArxiv(): Promise<SignalEvent[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", "cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV OR cat:cs.RO OR cat:cs.CR OR cat:astro-ph.CO OR cat:quant-ph");
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", "55");
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  const xml = await (await request(url.toString(), { "User-Agent": "SYMTRI/0.1 (https://symtri.com)" })).text();
  const events = normalizeArxivFeed(xml);
  if (!events.length) throw new Error("arXiv returned no usable papers");
  return events;
}
