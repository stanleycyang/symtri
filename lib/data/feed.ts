import { deduplicateSignals, uniqueSourceObservations } from "./normalize";
import { fetchArxiv, fetchArxivForIngestion, fetchGitHub, fetchGitHubForIngestion, fetchHackerNews, fetchHackerNewsForIngestion, fetchOpenAlex } from "./sources";
import { unavailableSources, type SignalEvent, type SignalFeed, type SourceId } from "./model";

export function selectFeedEvents(events: SignalEvent[], limit = 150): SignalEvent[] {
  return deduplicateSignals(events.filter((event) => event.topics.length > 0))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit)
    .map((event) => {
      if (!event.classificationInput) return event;
      const visible = { ...event };
      delete visible.classificationInput;
      return visible;
    });
}

export async function getSignalFeed(options: { includeUnclassified?: boolean; forIngestion?: boolean; slot?: string } = {}): Promise<SignalFeed> {
  if (options.forIngestion && !options.slot) throw new Error("An ingestion slot is required for source sampling");
  const sources: [SourceId, () => Promise<{ events: SignalEvent[]; status: "ok" | "partial" }>][] = [
    ["hacker-news", () => options.forIngestion ? fetchHackerNewsForIngestion() : fetchHackerNews().then((items) => ({ events: items, status: "ok" }))],
    ["github", () => options.forIngestion ? fetchGitHubForIngestion() : fetchGitHub().then((items) => ({ events: items, status: "ok" }))],
    ["arxiv", () => options.forIngestion ? fetchArxivForIngestion() : fetchArxiv().then((items) => ({ events: items, status: "ok" }))],
    ["openalex", () => fetchOpenAlex(options.forIngestion ? options.slot : undefined).then((items) => ({ events: items, status: "ok" }))],
  ];
  const results = await Promise.allSettled(sources.map(([, fetchSource]) => fetchSource()));
  const status = unavailableSources();
  const events: SignalEvent[] = [];
  results.forEach((result, index) => {
    const source = sources[index][0];
    if (result.status === "fulfilled") { status[source] = result.value.status; events.push(...result.value.events); }
    else console.warn(`SYMTRI source ${source}: ${result.reason instanceof Error ? result.reason.message : "unavailable"}`);
  });
  return {
    observedAt: new Date().toISOString(),
    events: options.includeUnclassified
      ? uniqueSourceObservations(events)
      : selectFeedEvents(events),
    sources: status,
    partial: Object.values(status).some((value) => value !== "ok"),
    scope: "sample",
  };
}
