<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## SYMTRI development note

Use canvas texture sprites for scene labels. Drei `Html` caused a React root unmount error during rendering with this Next.js 16 / React 19 setup; verify label changes in the production build and browser, not only in TypeScript.

Camera presets should animate only when location changes. Do not steer the camera toward a preset every render frame: that overrides OrbitControls drag and wheel input. Verify that orbit and zoom persist after a focus animation settles.

React Three Fiber can emit `onClick` after a drag. Gate scene navigation by the event's pointer travel (`event.delta`), then verify that dragging empty space or a node keeps the current focus while a deliberate empty click returns outward.

Keep `/api/signals` responses uncached when classification or feed display logic changes; upstream source fetches may retain a short revalidation window. Verify the rendered panel against the current classifier after such edits.

Before Vercel deployment work, run `vercel whoami` and check whether `.vercel` links the intended project and team. CLI sign-in does not guarantee project creation access. If project creation returns a 402 fair-use block, stop retries and ask the owner to resolve the block or name an authorized, unblocked team before connecting GitHub. Verify the local build and configuration before requesting missing account access.

In Vercel functions, OIDC arrives through the request context/header, not reliably through `process.env.VERCEL_OIDC_TOKEN`. For AI Gateway, let the AI SDK read it and verify a model response in production before declaring Gateway active.

For Postgres writes, run `npm run test:storage` with `SYMTRI_TEST_DATABASE_URL` pointed at an isolated loopback database. Postgres.js `sql.json(rows)` must be used for bulk JSON parameters; passing `JSON.stringify(rows)` produced a JSON string and broke `jsonb_to_recordset` at runtime despite passing typecheck.

Same-day snapshot retries must preserve both source coverage and mapped event count. Keep the downgrade cases in `scripts/check-storage.ts` and run `npm run test:storage:local` when changing the snapshot write.

For ingestion changes, test the canonical URL uniqueness and hourly slot claim in `scripts/check-storage.ts`. The cron route only queues a Vercel Workflow; check `/api/status` for completion after triggering it. When rotating `CRON_SECRET`, deploy fresh production functions before testing authorization because redeploying an older build may retain its environment snapshot. Keep the value out of logs and command output.

The Workflow CLI `start` command can target an older deployment even after a new Git deployment is ready. Inspect the returned run's `deploymentId` before using its result to verify new workflow code. Prefer the cron route on the current production alias for an end-to-end check.

After a Git deployment, wait for the production deployment to report Ready before judging dynamic API health. A first `/api/status` read has twice timed out briefly during rollout and then recovered; retry with a bounded timeout, then inspect runtime logs if it remains slow. For universe navigation changes, inspect both a 1440px desktop and a narrow mobile viewport, and verify a near-node click selects while a drag does not.
