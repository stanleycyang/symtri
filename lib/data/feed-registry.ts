import { createHash } from "node:crypto";
import { database, persistSignals } from "./storage";
import { fetchPublicText, feedLinkFromHtml, publicHttpsUrl } from "./public-fetch";
import { normalizeSyndicationFeed } from "./normalize";
import type { SignalEvent, SourceStatus } from "./model";
import { recordCatalogRevision } from "./catalog";

type FeedRow = { id: string; name: string; feed_url: string; status: "trial" | "active"; consecutive_failures: number; successful_days: number; last_success_day: Date | null; last_checked_at: Date | null };
const techTerms = /\b(?:technology|software|hardware|science|research|computer|computing|security|energy|engineering|robotics|artificial intelligence|machine learning|quantum|biotech|semiconductor|startup|cryptograph|blockchain)\b/i;
// Ten feeds per hourly slot gives each active feed a six-hour turn at this cap.
const MAX_ACTIVE_RSS_FEEDS = 60;

export async function discoverFeedCandidates(now = new Date()): Promise<number> {
  const sql = database();
  const probed = await sql`select count(*)::int as count from source_probes where checked_at::date = ${now.toISOString().slice(0, 10)}::date`;
  let budget = Math.max(0, 5 - Number(probed[0].count));
  if (!budget) return 0;
  const rows = await sql<{ url: string }[]>`
    select url from signal_events where source = 'hacker-news'
      and first_seen_at >= ${now}::timestamptz - interval '7 days'
    order by first_seen_at desc limit 500`;
  const domains = new Map<string, Set<string>>();
  for (const row of rows) {
    try {
      const url = new URL(row.url);
      if (url.protocol !== "https:" || /(?:github\.com|arxiv\.org|doi\.org|ycombinator\.com)$/.test(url.hostname)) continue;
      const links = domains.get(url.hostname) ?? new Set<string>();
      links.add(url.toString());
      domains.set(url.hostname, links);
    } catch { /* Ignore invalid source links. */ }
  }
  const existing = new Set((await sql<{ domain: string }[]>`select domain from source_probes
    where checked_at >= ${now}::timestamptz - interval '30 days'`).map((row) => row.domain));
  let discovered = 0;
  for (const [domain] of [...domains].filter(([, links]) => links.size >= 3).sort((a, b) => b[1].size - a[1].size)) {
    if (!budget || existing.has(domain)) continue;
    budget--;
    let result = "no-feed";
    try {
      const site = await fetchPublicText(`https://${domain}/`, 500_000);
      const feedLink = feedLinkFromHtml(site.text, site.url);
      if (feedLink) {
        await publicHttpsUrl(feedLink);
        const sourceId = `feed-${createHash("sha256").update(feedLink).digest("hex").slice(0, 16)}`;
        const feed = await fetchPublicText(feedLink);
        const events = normalizeSyndicationFeed(feed.text, sourceId);
        if (events.length >= 2) {
          await sql`insert into source_catalog (id, name, kind, feed_url, status)
            values (${sourceId}, ${domain}, 'rss', ${feedLink}, 'trial') on conflict (id) do nothing`;
          result = "trial";
          discovered++;
        }
      }
    } catch (error) { result = error instanceof Error ? error.message.slice(0, 80) : "unavailable"; }
    await sql`insert into source_probes (domain, checked_at, result) values (${domain}, ${now}, ${result})
      on conflict (domain) do update set checked_at = excluded.checked_at, result = excluded.result`;
  }
  return discovered;
}

async function fetchFeed(row: FeedRow): Promise<SignalEvent[]> {
  const fetched = await fetchPublicText(row.feed_url);
  const events = normalizeSyndicationFeed(fetched.text, row.id);
  if (!events.length) throw new Error("Feed returned no usable items");
  return events;
}

export async function fetchActiveFeeds(now = new Date(), load: (row: FeedRow) => Promise<SignalEvent[]> = fetchFeed): Promise<{ events: SignalEvent[]; sources: SourceStatus }> {
  const sql = database();
  const rows = await sql<FeedRow[]>`select id, name, feed_url, status, consecutive_failures, successful_days, last_success_day, last_checked_at
    from source_catalog where kind = 'rss' and status = 'active'
    order by last_checked_at nulls first limit ${MAX_ACTIVE_RSS_FEEDS}`;
  const events: SignalEvent[] = [];
  const due = (row: FeedRow) => !row.last_checked_at || row.last_checked_at.getTime() <= now.getTime() - 6 * 60 * 60 * 1000;
  const sources: SourceStatus = Object.fromEntries(rows.map((row) => [row.id,
    due(row) || row.consecutive_failures ? "partial" : "ok"]));
  for (const row of rows.filter(due).slice(0, 10)) {
    try {
      events.push(...await load(row));
      sources[row.id] = "ok";
      await sql`update source_catalog set last_checked_at = ${now}, consecutive_failures = 0 where id = ${row.id}`;
    } catch {
      sources[row.id] = "unavailable";
      await sql`update source_catalog set last_checked_at = ${now}, consecutive_failures = consecutive_failures + 1,
        status = case when consecutive_failures >= 2 then 'paused' else status end where id = ${row.id}`;
    }
  }
  return { events, sources };
}

export async function pollTrialFeeds(now = new Date(), load: (row: FeedRow) => Promise<SignalEvent[]> = fetchFeed): Promise<number> {
  const sql = database();
  await sql`delete from source_trial_items as item using source_catalog as source
    where source.id = item.source_id and (
      source.status = 'active' or item.first_seen_at < ${now}::timestamptz - interval '90 days')`;
  const rows = await sql<FeedRow[]>`select id, name, feed_url, status, consecutive_failures, successful_days, last_success_day, last_checked_at
    from source_catalog where kind = 'rss' and status = 'trial'
      and (last_checked_at is null or last_checked_at <= ${now}::timestamptz - interval '6 hours')
    order by last_checked_at nulls first limit 10`;
  let promoted = 0;
  for (const row of rows) {
    try {
      const events = await load(row);
      const relevant = events.filter((event) => event.topics.length > 0 || techTerms.test(`${event.title} ${event.summary}`));
      const day = now.toISOString().slice(0, 10);
      if (relevant.length / events.length < .7) throw new Error("Feed is not sufficiently relevant");
      const inserts = relevant.map((event) => ({ source_id: row.id, external_id: event.externalId, event }));
      await sql`insert into source_trial_items (source_id, external_id, event)
        select source_id, external_id, event from jsonb_to_recordset(${sql.json(inserts)}::jsonb)
        as incoming(source_id text, external_id text, event jsonb) on conflict do nothing`;
      const unique = Number((await sql`select count(*)::int as count from source_trial_items where source_id = ${row.id}`)[0].count);
      const previousDay = row.last_success_day instanceof Date ? row.last_success_day.toISOString().slice(0, 10) : String(row.last_success_day ?? "").slice(0, 10);
      const successfulDays = row.successful_days + (previousDay === day ? 0 : 1);
      await sql`update source_catalog set last_checked_at = ${now}, last_success_day = ${day}::date,
        successful_days = ${successfulDays}, unique_items = ${unique}, consecutive_failures = 0 where id = ${row.id}`;
      if (successfulDays < 3 || unique < 5) continue;
      const duplicates = await sql`select count(*)::int as count from source_trial_items as trial
        join signal_events as event on event.canonical_url = public.symtri_canonical_url(trial.event->>'url')
        where trial.source_id = ${row.id}`;
      if (Number(duplicates[0].count) / unique > .4) continue;
      const active = Number((await sql`select count(*)::int as count from source_catalog where kind = 'rss' and status = 'active'`)[0].count);
      const recent = Number((await sql`select count(*)::int as count from source_catalog where kind = 'rss' and promoted_at >= ${now}::timestamptz - interval '7 days'`)[0].count);
      if (recent >= 2) continue;
      const replacement = active >= MAX_ACTIVE_RSS_FEEDS ? await sql<{ id: string }[]>`
        select candidate.id from source_catalog as candidate
        where candidate.kind = 'rss' and candidate.status = 'active'
          and candidate.promoted_at < ${now}::timestamptz - interval '30 days'
          and not exists (select 1 from signal_observations as observation
            where observation.source = candidate.id
              and observation.first_seen_at >= ${now}::timestamptz - interval '30 days')
        order by candidate.promoted_at, candidate.id limit 1` : [];
      if (active >= MAX_ACTIVE_RSS_FEEDS && !replacement.length) continue;
      const trial = await sql<{ event: SignalEvent }[]>`select event from source_trial_items where source_id = ${row.id}`;
      await persistSignals({ observedAt: now.toISOString(), events: trial.map((item) => item.event), sources: { [row.id]: "ok" }, partial: false, scope: "sample" });
      await sql.begin(async (tx) => {
        if (replacement[0]) await tx`update source_catalog set status = 'paused' where id = ${replacement[0].id} and status = 'active'`;
        await tx`update source_catalog set status = 'active', promoted_at = ${now} where id = ${row.id} and status = 'trial'`;
      });
      await sql`delete from source_trial_items where source_id = ${row.id}`;
      promoted++;
    } catch {
      await sql`update source_catalog set last_checked_at = ${now}, consecutive_failures = consecutive_failures + 1,
        status = case when consecutive_failures >= 2 then 'paused' else 'trial' end where id = ${row.id}`;
    }
  }
  if (promoted) await recordCatalogRevision();
  return promoted;
}
