# Production operations

## Release

1. Confirm `vercel whoami` and `.vercel/project.json` target the intended account and project. Check `git status` and review the diff.
2. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run test:storage:local`. For storage or query changes, also run `npm run test:scale:local` with a representative row count.
3. Run `supabase db push --linked --dry-run`; review the pending migrations, then run `supabase db push --linked --yes`. Never print production connection strings or secret values.
4. Commit and push. Wait for the Git deployment to report Ready. Check `/api/status`, `/api/signals`, and the public browser experience. The deployment build runs unit tests and lint before build.
5. Wait for a completed hourly ingestion on the new deployment. Run `SYMTRI_MIN_COMPLETED_AT=<UTC-hour-start> npm run check:production`. After the minute-12 health cron, run `SYMTRI_REQUIRE_MONITOR=1 npm run check:production`. The latter requires the monitor result to match the latest ingest.

## Daily checks and recovery

- `/api/status` includes source coverage, RSS active/paused counts, backlog sizes, and the latest hourly monitor result. A degraded monitor includes specific issues; an unavailable monitor endpoint requires Vercel runtime logs and database checks.
- On the second UTC date and thereafter, use `SYMTRI_MIN_SNAPSHOT_DAYS=2 npm run check:production` to verify two dated snapshots. A single date on launch day cannot prove historical comparison.
- If ingestion is late or stalled, inspect the Vercel cron invocation, workflow run, and runtime logs before triggering the current production `/api/ingest` route. The route queues a workflow; wait for `/api/status` to show completion. Do not use a Workflow CLI result from an older deployment as proof of the new code.
- If RSS sources pause, inspect `growth.rss` in `/api/status`. Failure-paused feeds retry after 24 hours, up to two per hourly run when active capacity allows. Manual and capacity pauses require an operator decision. Keep the 60 active-feed budget until the scale check and source coverage justify a change.
- If the 3,000-per-day Ask quota is routinely reached by legitimate usage, review Gateway spend, function load, and daily traffic before raising it. A 429 response gives the visitor a retry time. Do not log IPs or persist raw IP addresses.

## Backups

- Confirm scheduled backup timestamps and retention in the linked Supabase project's **Database > Backups** page before major schema changes and periodically thereafter. A backup listing proves backups were scheduled; a restore drill is needed to prove restore time and application recovery.
- Supabase Pro provides daily scheduled backups with a seven-day retention window. Point-in-time recovery is a separate paid add-on and may also require a larger compute tier. Enable it only after the owner approves the current cost. See [Supabase's backup documentation](https://supabase.com/docs/guides/platform/backups) for current plan terms.
- The current production choice is to keep the included daily backups and leave paid point-in-time recovery disabled.
- For a restore drill, restore a backup into a separate project, apply any later migrations, set a temporary deployment's `DATABASE_URL` to that restored project, and verify status, signals, history, topic pagination, and Ask. Never point the production alias at the drill database.
