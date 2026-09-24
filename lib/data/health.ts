import type { SignalFeed, SnapshotDay } from "./model";
import { database, getIngestionStatus, getPersistedCurrentFeed, getSnapshotDays } from "./storage";
import { getGrowthStatus } from "./catalog";

type Status = Awaited<ReturnType<typeof getIngestionStatus>>;
type Growth = Awaited<ReturnType<typeof getGrowthStatus>>;
export type HealthCheck = { checkedAt: string; status: "healthy" | "degraded"; issues: string[]; warnings: string[]; runStartedAt: string | null };

export function evaluateProductionHealth(now: Date, status: Status, growth: Growth, feed: SignalFeed | null, days: SnapshotDay[], firstIngestionDay: string | null): HealthCheck {
  const issues: string[] = [];
  const warnings: string[] = [];
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(start.getTime() - 86_400_000).toISOString().slice(0, 10);
  const run = status.lastRun;
  if (!run?.completedAt || !["complete", "partial"].includes(run.status) || Date.parse(run.startedAt) < start.getTime()) {
    issues.push("Current UTC hour has no completed ingestion");
  } else {
    if (run.embeddingStatus !== "ok" || status.embeddingBacklog > 0) issues.push("Embedding backlog remains");
    if (Object.values(run.sources ?? {}).every((source) => source === "unavailable")) issues.push("All source feeds are unavailable");
    if (run.status === "partial") warnings.push("Ingestion source coverage is partial");
  }
  if (status.signals === 0 || !feed?.events.length || !feed.archiveCount) issues.push("Prepared public feed is unavailable");
  else if (run?.completedAt && (Date.parse(feed.observedAt) < Date.parse(run.startedAt) ||
    Date.parse(feed.observedAt) > Date.parse(run.completedAt))) issues.push("Prepared feed does not match the latest run");
  if (growth.graphDirtyDays > 0) issues.push("Knowledge graph has dirty days");
  if (growth.catalogBacklog > 2_000) issues.push("Catalog refresh backlog exceeds two hourly batches");
  if (!days.some((snapshot) => snapshot.day === today)) issues.push("Today has no historical snapshot");
  if (firstIngestionDay && firstIngestionDay <= yesterday && !days.some((snapshot) => snapshot.day === yesterday)) {
    issues.push("Yesterday has no historical snapshot");
  }
  if ((growth.rss?.active ?? 0) >= (growth.rss?.capacity ?? 60)) warnings.push("RSS source capacity is full");
  return { checkedAt: now.toISOString(), status: issues.length ? "degraded" : "healthy", issues, warnings,
    runStartedAt: run?.startedAt ?? null };
}

export async function runProductionHealthCheck(now = new Date()): Promise<HealthCheck> {
  const status = await getIngestionStatus();
  const growth = await getGrowthStatus();
  const feed = await getPersistedCurrentFeed();
  const days = await getSnapshotDays();
  const sql = database();
  const firstRun = await sql<{ day: string | null }[]>`select (min(started_at) at time zone 'UTC')::date::text as day from ingestion_runs
    where status in ('complete', 'partial')`;
  const result = evaluateProductionHealth(now, status, growth, feed, days, firstRun[0]?.day ?? null);
  await sql`insert into production_health_checks (checked_at, status, issues, warnings, run_started_at)
    values (${now}, ${result.status}, ${sql.json(result.issues)}::jsonb,
      ${sql.json(result.warnings)}::jsonb, ${result.runStartedAt})`;
  await sql`delete from production_health_checks where checked_at < ${new Date(now.getTime() - 30 * 86_400_000)}`;
  return result;
}

export async function getLatestProductionHealth(): Promise<HealthCheck | null> {
  const rows = await database()<{
    checked_at: Date; status: "healthy" | "degraded"; issues: string[]; warnings: string[]; run_started_at: Date | null;
  }[]>`select checked_at, status, issues, warnings, run_started_at
    from production_health_checks order by checked_at desc limit 1`;
  const row = rows[0];
  return row ? { checkedAt: row.checked_at.toISOString(), status: row.status,
    issues: row.issues, warnings: row.warnings, runStartedAt: row.run_started_at?.toISOString() ?? null } : null;
}
