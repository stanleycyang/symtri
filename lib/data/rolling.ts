import type { SignalFeed } from "./model";
import { canonicalSignalUrl, signalContentKey } from "./normalize";

const MAX_VISIBLE_SIGNALS = 300;

export function rollingFeed(live: SignalFeed, archive: SignalFeed | null, archiveCount: number): SignalFeed {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  // Prefer fresh source details while using the same identities as Postgres.
  const events = [...live.events, ...(archive?.events ?? [])]
    .filter((event) => {
      const canonical = canonicalSignalUrl(event.url);
      const content = signalContentKey(event);
      if (seenIds.has(event.id) || seenUrls.has(canonical) || seenContent.has(content)) return false;
      seenIds.add(event.id);
      seenUrls.add(canonical);
      seenContent.add(content);
      return true;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_VISIBLE_SIGNALS);
  if (!live.events.length && archive?.events.length) {
    return { ...archive, events, archiveCount };
  }
  return { ...live, events, scope: archive?.events.length ? "rolling" : "sample", archiveCount };
}
