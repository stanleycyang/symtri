<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## SYMTRI development note

Use canvas texture sprites for scene labels. Drei `Html` caused a React root unmount error during rendering with this Next.js 16 / React 19 setup; verify label changes in the production build and browser, not only in TypeScript.

Camera presets should animate only when location changes. Do not steer the camera toward a preset every render frame: that overrides OrbitControls drag and wheel input. Verify that orbit and zoom persist after a focus animation settles.

React Three Fiber can emit `onClick` after a drag. Gate scene navigation by the event's pointer travel (`event.delta`), then verify that dragging empty space or a node keeps the current focus while a deliberate empty click returns outward.

When a screen or panel is hidden after interaction, make its controls inert and return keyboard focus to the control that opened it. Verify Tab and Escape in the production browser; `aria-hidden` alone left focus inside the departing entrance, and closing Ask dropped focus to the page body.

Keep `/api/signals` responses uncached when classification or feed display logic changes; upstream source fetches may retain a short revalidation window. Verify the rendered panel against the current classifier after such edits.

When changing classification, bump `CLASSIFIER_VERSION` in `lib/data/classify.ts`. The hourly workflow reclassifies up to 1,000 stored signals per run when it has their original classification input. Verify the affected archive signals and knowledge graph after ingestion; older GitHub and arXiv rows from before classification inputs were stored still need a fresh source observation or targeted backfill.
Guard ambiguous topic words with negative examples from the live feed. Disk space is not astronomy, and device activity data alone is not hardware; prefer concrete hardware terms and rerun the focused classifier tests before deployment.

Archive reads apply the current classifier to stale rows with saved inputs, so removed false matches disappear from the map before the next hourly write. New matches and cumulative knowledge graph links still need the next ingestion run; verify them after the backlog clears.

Before Vercel deployment work, run `vercel whoami` and check whether `.vercel` links the intended project and team. CLI sign-in does not guarantee project creation access. If project creation returns a 402 fair-use block, stop retries and ask the owner to resolve the block or name an authorized, unblocked team before connecting GitHub. Verify the local build and configuration before requesting missing account access.

In Vercel functions, OIDC arrives through the request context/header, not reliably through `process.env.VERCEL_OIDC_TOKEN`. For AI Gateway, let the AI SDK read it and verify a model response in production before declaring Gateway active.

For Postgres writes, run `npm run test:storage` with `SYMTRI_TEST_DATABASE_URL` pointed at an isolated loopback database. Postgres.js `sql.json(rows)` must be used for bulk JSON parameters; passing `JSON.stringify(rows)` produced a JSON string and broke `jsonb_to_recordset` at runtime despite passing typecheck.

Same-day snapshot retries must preserve both source coverage and mapped event count. Keep the downgrade cases in `scripts/check-storage.ts` and run `npm run test:storage:local` when changing the snapshot write.
Compare each source's coverage level (`ok` > `partial` > `unavailable`) when deciding whether a same-day snapshot can be replaced; equal counts of healthy sources can hide a swapped or degraded source.

For ingestion changes, test the canonical URL uniqueness and hourly slot claim in `scripts/check-storage.ts`. The cron route only queues a Vercel Workflow; check `/api/status` for completion after triggering it. When rotating `CRON_SECRET`, deploy fresh production functions before testing authorization because redeploying an older build may retain its environment snapshot. Keep the value out of logs and command output.
Use `npm run check:production` after an hourly run to inspect status and snapshot coverage without repeating manual endpoint calls or spending Gateway tokens.
Canonical URL matching must retain query parameters that identify content (especially Hacker News `item?id=...`). Strip only known tracking parameters, and keep the TypeScript normalizer, Postgres generated column, and observation lookup aligned. Test two distinct query-identified documents in both unit and local Postgres checks.
Keep source observations until after persistence. A same-run Hacker News link to a GitHub repository should create one canonical signal and two observation rows; deduplication for the public map happens separately. Cover this with a same-batch local Postgres check.

Hourly Workflow source fetches must use `cache: "no-store"`. A 15-minute `next.revalidate` cache can serve stale data on the first request after expiry, making hourly ingestion one run behind. Keep the direct public preview's short cache separate, and verify a newly published source item after the next cron run.
Keep a bounded replay window for Hacker News new stories so a missed or stale hourly run can recover them; storage deduplicates replayed events. Verify the window reaches stories older than the first hour without making the source step unbounded.
An ingestion run should report Hacker News unavailable when its newest-story list fails or its newest usable story is stale. A healthy top-story response alone does not prove the hourly feed is fresh.
Retry a bounded number of rejected Hacker News item requests once. Keep the stories that succeeded, and mark Hacker News partial if any item requests remain unresolved; do not silently claim full coverage.
Keep successful arXiv query groups when another group fails. Report the source as partial rather than claiming full coverage or discarding fetched papers; an all-group failure remains unavailable.
Space arXiv API requests at least three seconds apart. Retry a failed query group once after a longer pause; do not retry indefinitely or mark the source ok if the second attempt fails. Cover transient recovery and permanent partial coverage in `lib/data/sources.test.ts`.
Blended arXiv category queries can crowd out a named subject even when its category appears in the query. When a promised subject has no live Ask evidence, check a focused category sample before adding a bounded ingestion group. Verify the first hourly run puts a recent paper into Ask, and update the request count, pause count, and per-run paper budget in source tests and docs.
Likewise, keep popular GitHub repositories if the recent-update search fails, but mark GitHub partial so the run does not claim complete coverage.

Serve `/api/signals` and mapped Ask questions from the persisted hourly archive once it contains signals. Per-visitor Hacker News, GitHub, and arXiv fetches multiply source traffic and make exploration depend on those APIs; keep direct source fetches only for an empty archive or a local database-free preview. Verify both routes with `npm run test:storage:local`.
For archive-only Ask questions, require meaningful vector similarity and keep indexed text matches ahead of vector-only neighbors. Weak nearest neighbors caused unrelated stories to be presented as relevant sources; retain the negative retrieval case in `scripts/check-storage.ts`.
Strip generic recency and publication words plus common leading question phrases from archive lexical queries so "What is new in exoplanet research?" and "What do we know about exoplanets?" can find papers about exoplanets. Preserve subject words such as "people" outside those phrases, keep substantive terms conjunctive, and verify an unrelated subject still returns no evidence in the local Postgres check.
When adding Ask thread aliases, use phrases that identify the map context for generic child names such as design, growth, product, and networks. Test both the intended route and an unrelated question containing the generic word; false map routing hides the full knowledge archive.
For an Ask question naming a specific map thread, keep that map location but do not cite unrelated parent-region stories when the thread has no matching source. Verify a real empty thread, such as Climate Science, returns no filler sources.

The overview caps its event payload. A focused region or thread fetches recent matching archive events through `/api/topic`; keep those detail results distinct from the capped map activity calculation, and verify a niche source remains reachable beyond the overview cap.

The Workflow CLI `start` command selects the deployment of its newest prior run, even after a newer Git deployment is Ready; setting `VERCEL_DEPLOYMENT_ID` does not override that selection. Inspect the new run's `deploymentId` before using its result to verify new workflow code. Prefer the cron route on the current production alias for an end-to-end check.

After a Git deployment, wait for the production deployment to report Ready before judging dynamic API health. `/api/status` has stalled after rollout, including one logged 300-second runtime timeout; retry with a bounded timeout and inspect runtime logs if it remains slow. For universe navigation changes, inspect 1440px desktop, 756×469 short desktop, and narrow mobile viewports, and verify a near-node click selects while a drag does not.
For scene-label changes, inspect the unfocused overview at 1440px and 756×469 after camera easing settles. Check nearby labels against each other and against the header; perspective can make well-spaced world positions collide on screen. Keep an offset label visually associated with its node.
When Ask focuses a map location at 756×469, keep the focused scene visible beside the Ask panel. Showing Ask and the topic detail panel together can cover the entire map; verify the detail panel returns when Ask closes.

Postgres.js uses one connection per function instance in this app. Keep database reads sequential within an invocation and keep `idle_timeout` finite so warm Vercel Workflow and API functions release pooled connections. Repeated status or signals stalls are a runtime failure: check Vercel logs for the 300-second timeout, then verify both endpoints after deployment.
Supabase documents that frozen serverless functions can resume with a dead Postgres.js socket while the idle timer was paused. The shared client is recycled after an idle gap; keep this safeguard when changing pooling, and verify `/api/status` and `/api/signals` after a warm-instance pause.

Postgres.js query results are untyped `Row` values unless the SQL call has a generic row shape. Type rows before passing them to typed helpers, or validate optional fields inside the helper; TypeScript has caught this twice in storage changes.
