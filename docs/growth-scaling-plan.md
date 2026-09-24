# Growth scaling execution plan

The archive is durable; the scene and public responses are bounded views of it. Growth must not silently make a point's older evidence unreachable or make ingestion cost proportional to all historical signals each hour.

## 1. Browse every point

- Add a cursor-paginated, source-backed topic archive beyond the three highlighted signals and the 14-day map window. Preserve the three highlights as an entry point.
- Show full-window counts computed at ingestion, rather than counts from the 300-signal rendering sample.
- Keep the historical snapshot view explicitly point-in-time; archive pagination is for the current view.
- Verify ordering, no duplicate pages, deep records, and a child whose matches fall outside the 300-signal map sample.

## 2. Bound presentation work

- Limit 3D child nodes around a focused region, always retaining the selected and Ask path nodes. The full child index remains searchable and browsable in the panel.
- Render the child index in pages and memoize map search candidates. Keep keyboard and mobile navigation usable.
- Verify focused desktop, short desktop, mobile, and WebGL fallback paths in a production build.

## 3. Bound database work

- Read public counts and child activity from completed ingestion metadata. Avoid exact all-archive counts on visitor requests.
- Replace the all-history hourly graph scan with daily graph rollups and dirty-day repair. Source-status and observation changes must invalidate affected days.
- Index and fairly drain the catalog refresh backlog. Keep source queries bounded with indexes and explicit budgets.
- Verify local Postgres migrations, cross-source visibility, graph totals, pagination, and backlog progress; inspect query plans at larger archive sizes before raising source budgets.

## 4. Grow source and concept coverage

- Sample discovery across sources instead of selecting only the globally newest records. Rotate bounded active-feed slots using quality and freshness; never disable a healthy feed merely because it is old.
- Track discovery and sync backlog in status. Add a retention policy for trial evidence while retaining the durable public archive.
- Run production checks after deployment, including the first completed hourly workflow. Compare archive and point growth, source coverage, and response size.

Release gate: tests, typecheck, build, isolated database check, production UI checks, migration application, then a completed production hourly run. Do not call the work live until the migration and run are verified.
