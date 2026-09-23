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

Before Vercel deployment work, run `vercel whoami` and check whether `.vercel` links a project. CLI credentials have been absent across setup attempts; request login and project access only after the local build and configuration are ready.

For Postgres writes, run `npm run test:storage` with `SYMTRI_TEST_DATABASE_URL` pointed at an isolated loopback database. Postgres.js `sql.json(rows)` must be used for bulk JSON parameters; passing `JSON.stringify(rows)` produced a JSON string and broke `jsonb_to_recordset` at runtime despite passing typecheck.
