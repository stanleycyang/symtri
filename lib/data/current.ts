import { getSignalFeed } from "./feed";
import { getArchiveCount, getLatestIngestionFeedMetadata, getStoredFeed } from "./storage";
import type { SignalFeed } from "./model";

export async function getCurrentFeed(): Promise<SignalFeed> {
  if (!process.env.DATABASE_URL) return getSignalFeed();
  const archiveCount = await getArchiveCount();
  if (!archiveCount) return getSignalFeed();

  const archive = await getStoredFeed();
  if (!archive?.events.length) throw new Error("No recent classified signals in archive");
  const latest = await getLatestIngestionFeedMetadata();
  const stale = !latest || Date.now() - Date.parse(latest.observedAt) > 3 * 60 * 60 * 1000;
  return {
    ...archive, ...latest, observedAt: new Date().toISOString(), archiveCount,
    activity: stale ? undefined : latest?.activity,
    partial: stale || latest?.partial || false,
    scope: stale ? "archive" : "rolling",
  };
}
