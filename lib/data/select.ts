import type { SignalEvent } from "./model";

export function selectRegionHighlights(events: SignalEvent[], regionId: string, limit = 3): SignalEvent[] {
  return events.filter((event) => event.topics.some((match) => match.topicId === regionId))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
}
