import type { SignalEvent } from "./model";

export function selectRegionHighlights(events: SignalEvent[], regionId: string, limit = 3): SignalEvent[] {
  return events.filter((event) => event.topics.some((match) => match.topicId === regionId))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
}

export function selectDistinctHeadlines<T extends { title: string }>(items: T[], limit: number, excludedTitles: string[] = []): T[] {
  const terms = (title: string) => new Set(title.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const similar = (first: string, second: string) => {
    const a = terms(first);
    const b = terms(second);
    const shared = [...a].filter((term) => b.has(term)).length;
    return shared >= 3 && shared / Math.min(a.size, b.size) >= .8 && shared / (a.size + b.size - shared) >= .6;
  };
  const chosen: T[] = [];
  for (const item of items) {
    if ([...excludedTitles, ...chosen.map((entry) => entry.title)].some((title) => similar(title, item.title))) continue;
    chosen.push(item);
    if (chosen.length === limit) break;
  }
  return chosen;
}
