import { deduplicateSignals } from "./normalize";
import { fetchArxiv, fetchGitHub, fetchHackerNews } from "./sources";
import type { SignalEvent, SignalFeed, SourceId, SourceStatus } from "./model";

export async function getSignalFeed(): Promise<SignalFeed> {
  const sources: [SourceId, () => Promise<SignalEvent[]>][] = [
    ["hacker-news", fetchHackerNews], ["github", fetchGitHub], ["arxiv", fetchArxiv],
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
    events: deduplicateSignals(events).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 150),
    sources: status,
    partial: Object.values(status).some((value) => value !== "ok"),
    scope: "sample",
  };
}
