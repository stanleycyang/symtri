import { getSignalFeed } from "./feed";
import { getArchiveCount, getLatestIngestionFeedMetadata, getPersistedCurrentFeed, getStoredFeed } from "./storage";
import { unavailableSources, type SignalFeed } from "./model";
import { getUniverseCatalog } from "./catalog";

export async function getCurrentFeed(readyOnly = false): Promise<SignalFeed> {
  if (!process.env.DATABASE_URL) {
    return readyOnly ? emptyPublishedFeed() : getSignalFeed();
  }
  const prepared = await getPersistedCurrentFeed();
  if (prepared) {
    // Read readiness at request time: notes completed between hourly ingestions
    // become visible immediately, with reservations applied before the map cap.
    const events = readyOnly ? (await getStoredFeed(true))?.events ?? [] : prepared.events;
    const stale = Date.now() - Date.parse(prepared.observedAt) > 3 * 60 * 60 * 1000;
    return { ...prepared, events, observedAt: new Date().toISOString(), lastIngestedAt: prepared.observedAt,
      activity: stale ? undefined : prepared.activity, partial: stale || prepared.partial,
      scope: stale ? "archive" : "rolling" };
  }
  const archiveCount = await getArchiveCount();
  if (!archiveCount) {
    return readyOnly ? emptyPublishedFeed() : getSignalFeed();
  }

  const archive = await getStoredFeed(readyOnly);
  if (!archive?.events.length && !readyOnly) throw new Error("No recent classified signals in archive");
  const latest = await getLatestIngestionFeedMetadata();
  const stale = !latest || Date.now() - Date.parse(latest.observedAt) > 3 * 60 * 60 * 1000;
  return {
    ...(archive ?? { events: [], sources: {} }), ...latest, observedAt: new Date().toISOString(), archiveCount,
    lastIngestedAt: latest?.observedAt,
    activity: stale ? undefined : latest?.activity,
    partial: stale || latest?.partial || false,
    scope: stale ? "archive" : "rolling",
    catalog: await getUniverseCatalog(),
  };
}

function emptyPublishedFeed(): SignalFeed {
  return { observedAt: new Date().toISOString(), events: [], sources: unavailableSources(),
    partial: true, scope: "sample" };
}
