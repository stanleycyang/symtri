# Production release review — 2026-10-13

Scope: the full uncommitted worktree, including SEO discovery/indexing, source pagination, newsletter preferences and dialogs, report generation/persistence, RSS, and deployment configuration. The user authorized production deployment after review.

No release-blocking findings were identified. Review covered server/client boundaries, cursor and route validation, canonical URLs, date provenance, visible/schema consistency, sequential database access, JSONB writes, archive/sample scope, model output support checks and fallback behavior, external draft idempotency, template escaping, accessibility/focus restoration, and preservation of the existing scene interaction safeguards.

Fresh verification: lint and typecheck passed; 222 unit tests passed; the isolated PostgreSQL 17 storage/report suite passed. The storage suite exercises canonical observations, immutable retries, snapshot coverage, archive-backed retrieval beyond rendering caps, first-seen dates, point-in-time report bounds, current reading-note eligibility, and JSONB report revisions. Production builds also run unit tests and lint before Next.js build.

Browser QA from the local production build covers desktop, short desktop and narrow mobile, WebGL and no-WebGL paths, map clicks versus dragging, orbit persistence, Ask focus and Escape, source pagination, Browse navigation, source-date presentation, and directory database-outage fallback. Production smoke checks are recorded separately in the release gate and deployed crawl.

The release uses a fresh Vercel build with production environment configuration; the isolated-fixture local `.next` output is not deployed. No database migration, outreach, email sending, or model-generation test is part of the release verification. Existing email integration creates reviewable drafts only. Search rankings and AI citations remain external measurements, not acceptance claims.

Production smoke checks passed at desktop, short desktop, and narrow mobile. The entrance has no canvas before entry; WebGL mounts after entry. Ask Escape restores its trigger, Browse closes Ask and focuses the directory, source and report pages have no mobile horizontal overflow, and the no-WebGL session confirmed a null context before entering and retained region/source navigation. A browser helper wait expected an accessibility label as visible text; it was cancelled and replaced by a fresh snapshot. Two later helper lookups used stale refs; fresh snapshots confirmed the interactions. These were automation issues, not application failures.
