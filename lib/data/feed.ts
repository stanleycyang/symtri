import { deduplicateSignals } from "./normalize";
import { fetchArxiv, fetchGitHub, fetchHackerNews } from "./sources";
import type { SignalEvent, SignalFeed, SourceId, SourceStatus } from "./model";

export function selectFeedEvents(events: SignalEvent[], limit = 150): SignalEvent[] {
  return deduplicateSignals(events.filter((event) => event.topics.length > 0))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
}

export async function getSignalFeed(options: { includeUnclassified?: boolean; forIngestion?: boolean } = {}): Promise<SignalFeed> {
  const sources: [SourceId, () => Promise<SignalEvent[]>][] = [
    ["hacker-news", () => fetchHackerNews(options.forIngestion)],
    ["github", () => fetchGitHub(options.forIngestion)],
    ["arxiv", () => fetchArxiv(options.forIngestion)],
  ];
  const results = await Promise.allSettled(sources.map(([, fetchSource]) => fetchSource()));
  const status: SourceStatus = { "hacker-news": "unavailable", github: "unavailable", arxiv: "unavailable" };
  const events: SignalEvent[] = [];
  results.forEach((result, index) => {
    const source = sources[index][0];
    if (result.status === "fulfilled") { status[source] = "ok"; events.push(...result.value); }
    else console.warn(`SYMTRI source ${source}: ${result.reason instanceof Error ? result.reason.message : "unavailable"}`);
  });
  return {
    observedAt: new Date().toISOString(),
    events: options.includeUnclassified
      ? deduplicateSignals(events).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      : selectFeedEvents(events),
    sources: status,
    partial: Object.values(status).some((value) => value !== "ok"),
    scope: "sample",
  };
}
