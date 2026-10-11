# Ingestion and enrichment production review

## Release status

Local verification completed on 2026-10-11 UTC. The additive production migration
was applied through Supabase and recorded as `20261011045159_enrichment_pipeline`.
All 32,258 existing ready notes received publication metadata and cached notes.
Application deployment and post-deployment workflow checks are the remaining gates.

## Changes reviewed

- Ingestion persists observations before dispatching enrichment. Database triggers
  commit queue entries with their input writes. Dispatch failure retains the queue;
  the five-minute sweep recovers it.
- Dispatch reserves lanes before starting workflows. Reservations expire after
  five minutes; processing renews a fifteen-minute worker lease. Conditional
  release cannot release a replacement owner's lease.
- Each processing step claims one note at a time, up to five notes and a two-minute
  admission budget. Each lane retains a ten-note ceiling. A full lane has four
  durable steps instead of twelve, excluding independent embedding work. This is
  an orchestration reduction, not a measured billing reduction.
- Model generation and publication require current note ownership. Commits check
  input revision, token, working state, and unexpired note lease. Hydration can
  advance a revision; an expired unchanged claim cannot renew itself.
- Successful notes are cached by effective input fingerprint. Meaningful text,
  provenance, source, license, publication date/meaning, and note-version changes
  invalidate reuse. Collection times, tracking parameters, whitespace, and
  transport metadata do not. A shorter mirrored observation is retained without
  invalidating a ready note's stronger evidence.
- Thin or restricted evidence never reaches generation. Temporary failures back
  off with a three-attempt ceiling; permanent failures block until input/version
  changes or a deliberate single-note operator retry.
- Publication records a revision and version. All live public retrieval paths
  apply readiness before their result limits. Historical excerpts and full-window
  archive activity remain available for their existing purposes.
- Hourly ingestion retains classification, current archive membership, complete
  activity/relationship calculations, snapshots, and bounded embedding work.
  Discovery and historical repair run every six hours in bounded phases.
  Changed-evidence embeddings have a fifteen-minute recovery schedule and share
  an embedding lease with ingestion.
- Cron routes require the existing secret. New schema uses invoker functions,
  existing private tables/RLS, and a publication sequence with PUBLIC access
  revoked. Database calls remain sequential within each invocation.

## Verification evidence

- Production Next.js/Workflow build and TypeScript: passed (four workflows,
  thirteen unique steps). ESLint passed without warnings.
- Full unit suite: 156 passed, including the previously blocked HTTP tests.
- Isolated PostgreSQL 17/pgvector integration suite: passed using
  `SYMTRI_PG_BIN=/opt/homebrew/opt/postgresql@17/bin npm run test:storage:local`.
  This exercised all migrations, publication before result caps, ready-only Ask,
  cache reuse without model calls, shorter mirrors, dispatch reservations,
  expired/stale claims, and permanent-failure recovery.
- Corrected integration fixtures: publication-date changes invalidate embeddings,
  so related-story fixtures regenerate them; crowding fixtures must be newer
  than the story they are intended to displace.
- Production-build browser QA used isolated local fixture responses at 1440×900,
  756×469, and 390×844. Removed stories return focus to the region heading and
  remain removed despite topic refreshes; Tab reaches Browse, and Escape from
  Ask returns to its trigger. WebGL rendering was inspected; fallback checks
  use a separate browser with a confirmed unavailable WebGL context.
- Supabase migration verification: 32,258/32,258 ready notes have cached notes,
  matching publication revisions, and publication versions. Both trigger
  functions are invokers with fixed search paths. Advisors introduced no new
  findings and removed the queue function's mutable-search-path warning.
- Vercel identity/project confirmed as `stanleycyang`, team `testimonio`, project
  `prj_kVMdmGGqBZ8TbRa7G3fTuQob1mmC`; GitHub remote is reachable.

## Required rollout gates

1. In an environment allowing loopback, run `npm test`, `npm run lint`,
   `npm run typecheck`, `npm run build`, and `npm run test:storage:local` with a
   working PostgreSQL/pgvector installation (`SYMTRI_PG_BIN` can select it).
2. Verify ready-only browsing and source removal in the production build at
   1440px, 756×469, and narrow mobile. Check Ask, historical excerpts, keyboard
   focus after a removed source, and both WebGL and fallback rendering.
3. Review/apply `20261011045159_enrichment_pipeline.sql` before deploying code that
   reads its columns. Its additions support older deployed functions; do not drop
   the added schema during an application rollback. Run database advisors.
4. Confirm the linked Vercel project/team with `vercel whoami`, `.vercel/project.json`,
   and explicit team scope. Push only after the local gates pass; wait for Ready.
5. Verify immediate dispatch, a cron recovery sweep, an embedding pass, and a
   maintenance run on that deployment. Inspect run deployment IDs and completion.
   Use `npm run check:production` after ingestion and check both status and signals
   after a warm-instance pause.
6. Compare billing, published throughput, generation/reuse counts, publication
   delay, blocked notes, and oldest queued input over a representative period.
   These new counters start at migration time. A cheaper bill with a growing
   hidden backlog does not pass the acceptance criteria.

If rollout reveals a regression, restore the previous application deployment,
retain the additive schema, and inspect pending work before retrying. Previous
application behavior can expose unfinished stories, so verify the public feed
after rollback as well.
