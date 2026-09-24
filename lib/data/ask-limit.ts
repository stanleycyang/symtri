import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { database } from "./storage";

const VISITOR_HOURLY_LIMIT = 60;
const SITE_DAILY_LIMIT = 3_000;

function visitorIdentity(request: Request): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "";
  const address = forwarded.split(",", 1)[0].trim();
  const value = isIP(address) ? address : "unknown";
  return createHmac("sha256", process.env.CRON_SECRET ?? "local-development")
    .update(value).digest("hex");
}

export async function checkAskRateLimit(request: Request, now = new Date()): Promise<number | null> {
  if (!process.env.DATABASE_URL) return null;
  const sql = database();
  const hour = new Date(now);
  hour.setUTCMinutes(0, 0, 0);
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const visitor = await sql`insert into ask_request_buckets (scope, identity_hash, bucket_start, requests)
    values ('visitor-hour', ${visitorIdentity(request)}, ${hour}, 1)
    on conflict (scope, identity_hash, bucket_start) do update
      set requests = ask_request_buckets.requests + 1
      where ask_request_buckets.requests < ${VISITOR_HOURLY_LIMIT}
    returning requests`;
  if (!visitor.length) return Math.max(1, Math.ceil((hour.getTime() + 3_600_000 - now.getTime()) / 1000));
  const site = await sql`insert into ask_request_buckets (scope, identity_hash, bucket_start, requests)
    values ('site-day', 'all', ${day}, 1)
    on conflict (scope, identity_hash, bucket_start) do update
      set requests = ask_request_buckets.requests + 1
      where ask_request_buckets.requests < ${SITE_DAILY_LIMIT}
    returning requests`;
  return site.length ? null : Math.max(1, Math.ceil((day.getTime() + 86_400_000 - now.getTime()) / 1000));
}

export async function pruneAskRateLimits(now = new Date()): Promise<void> {
  await database()`delete from ask_request_buckets where bucket_start < ${new Date(now.getTime() - 2 * 86_400_000)}`;
}
