import type { SignalFeed } from "./model";
import { canonicalSignalUrl } from "./normalize";

const MAX_VISIBLE_SIGNALS = 300;

export function rollingFeed(live: SignalFeed, archive: SignalFeed | null, archiveCount: number): SignalFeed {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  // Prefer fresh source details while using the same URL identity as Postgres.
  const events = [...live.events, ...(archive?.events ?? [])]
    .filter((event) => {
      const canonical = canonicalSignalUrl(event.url);
      if (seenIds.has(event.id) || seenUrls.has(canonical)) return false;
      seenIds.add(event.id);
      seenUrls.add(canonical);
      return true;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_VISIBLE_SIGNALS);
  if (!live.events.length && archive?.events.length) {
    return { ...archive, events, archiveCount };
  }
  return { ...live, events, scope: archive?.events.length ? "rolling" : "sample", archiveCount };
}
