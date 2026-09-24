import type { SignalFeed } from "./model";

const MAX_VISIBLE_SIGNALS = 300;

export function rollingFeed(live: SignalFeed, archive: SignalFeed | null, archiveCount: number): SignalFeed {
  const events = [...new Map([
    ...(archive?.events ?? []).map((event) => [event.id, event] as const),
    ...live.events.map((event) => [event.id, event] as const),
  ]).values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_VISIBLE_SIGNALS);
  if (!live.events.length && archive?.events.length) {
    return { ...archive, events, archiveCount };
  }
  return { ...live, events, scope: archive?.events.length ? "rolling" : "sample", archiveCount };
}
