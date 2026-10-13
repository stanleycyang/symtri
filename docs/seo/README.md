# SYMTRI SEO/AEO audit and implementation

Observed October 13, 2026. The goal is a discoverable, source-grounded knowledge map for developers and technical researchers. An implementation can improve access, usefulness, and measurement; it cannot establish category leadership, indexing, ranking, or AI citations without observing those outcomes.

## Strategy and initial focus

Start with AI agents, coding agents, their evaluations, and their connections to developer tools. SYMTRI already has persisted evidence, dedicated subjects, and weekly reporting for this audience. Its differentiator is a navigable archive with traceable sources and explicitly scoped connection counts, rather than another unsourced technology-news summary.

Use `/ai/agents` and `/ai/coding-agents` for timely source discovery; `/software/developer-tools`, `/software/open-source`, and `/software/databases` for adjacent projects; `/signal` and permanent weekly URLs for curated synthesis; and `/about#methodology` for trust and interpretation. The homepage connects these destinations through a public subject directory. The fixed 25-query mapping is in [query-benchmark.json](query-benchmark.json). This is an editorial starting hypothesis, not measured keyword volume or search demand.

An exploratory web search surfaced dedicated coding-agent indexes and source-linked technical briefings, such as [LLMs Technical Reviews](https://llms-technical-reviews.com/coding-agents/) and [Harshit Bhatia’s briefings](https://harshitbhatia.in/briefing). These are comparison candidates for format and source clarity, not a measured competitive ranking or citation-share analysis. Keep SYMTRI’s map and evidence-navigation advantage; do not produce generic comparison pages merely to target their brands.

## Before/after scorecard

| Area | Initial live evidence | Implemented and verified |
| --- | --- | --- |
| Homepage discovery | Server HTML linked only to About; map operation was needed for topic exploration | Visible SSR subject directory, ordinary links to all public regions/threads, priority AI routes, weekly report and methodology links, keyboard skip path |
| Empty subjects | All 81 sitemap URLs returned 200, but 11 contained no readable evidence and were indexable | Sitemap and metadata share a three-readable-source editorial floor; sparse subjects stay browsable with `noindex, follow` |
| Subject context | Generic descriptions; “Agents” had no explicit AI meaning in its heading | Explicit AI/coding-agent names, original region and priority-thread context, evidence interpretation and methodology links |
| URL variants | HTTP and trailing-slash variants redirected correctly; WWW served duplicate public pages with a canonical tag | Permanent WWW redirect for public pages retains query identifiers; API and Workflow hosts stay unchanged |
| Archive access | Ten-source preview with no ordinary link to older sources | Stable cursor routes, newer/older links, self-canonical pagination, `noindex, follow`; browser verified fixtures 1–10 versus 11–20 |
| Connections | Seeded related regions labeled “Connected regions” | Measured full-window shared-signal counts distinguished from editorial navigation; region totals are explicitly not thread-specific |
| Source and timing scope | Publication dates could be mistaken for freshness; sitemap lastmod derived from a capped source sample | Paper publication, repository creation, model/dataset activity, discussion posts, catalog additions, and stored first-archive dates labeled separately; archive list distinguished from live fourteen-day counts; recorded ingestion window shown; uncertain topic lastmod omitted and report revisions supported |
| Startup work | Running WebGL behind the welcome screen; external CSS font import | Lightweight constellation welcome, WebGL mounted on entry, same interactive map after entry, self-hosted fonts using Next’s installed font API |
| Structured data | WebSite, Dataset, BreadcrumbList, AboutPage, and Article existed | CollectionPage/ItemList reflects visible source links; Dataset only emitted for available measured counts; report authorship credits SYMTRI with visible attribution; OG image route allowed to crawlers |
| Trust | Brief collection/Ask explanation and creator link | Classification versions, canonical deduplication, count scope, historical bounds, availability limits, evidence caveats, AI use, and corrections procedure |
| Measurement | Vercel telemetry existed; no repeatable cross-platform benchmark artifact | Fixed 25-query set, validated JSONL recorder, reproducible measurement procedure, captured field baseline, event and referral evidence |

Three sources is a project publication threshold, not a search-engine requirement or a sufficient content-quality test. A successful but sparse archive query causes noindex. An evidence outage is not treated as confirmed emptiness in metadata; uncertain pages are omitted from sitemap generation. Readable archived evidence is checked independently of the map’s 300-detail cap. Quiet subjects remain accessible to people, and invalid subjects remain 404.

## Performance evidence

| Measurement | Before: live homepage | After: live homepage |
| --- | --- | --- |
| Lighthouse mobile performance | 39/100 | 95/100 |
| Lab LCP | 5.3 s | 2.6 s |
| Lab Total Blocking Time | 9,000 ms | 100 ms |
| Lab CLS | 0.004 | 0 |
| Lighthouse accessibility / basic SEO | 100 / 100 | 100 / 100 |

Both live runs used the same Lighthouse configuration and SwiftShader Chrome flags. They are single lab runs with different execution times and cache/network conditions, not a controlled causal experiment. SwiftShader can exaggerate graphics CPU cost. Lighthouse SEO is a basic technical checklist, not a ranking or citation score. The after lab LCP is still slightly above the 2.5-second target; monitor cold mobile visits and prioritize the remaining text/font loading path if that persists.

Existing field p75 homepage values were LCP 1,164 ms, INP 120 ms, and CLS 0.0561. There were only 15 homepage LCP samples, five About samples, and one topic and one report sample. The data predates verification of the final changes, mixes devices, and may include test traffic. It is not enough to declare durable mobile performance. Vercel exposed 21 pageviews in its captured window and map/thread/Ask/newsletter events. Referrer reporting exposed a blank hostname; organic and AI attribution remains unknown. See [field-baseline-2026-10-13.json](field-baseline-2026-10-13.json).

Compact lab artifacts: [before](lighthouse-before.json), [local after](lighthouse-after.json), and [live after](lighthouse-live-after.json). The public PageSpeed API returned HTTP 429, so no PageSpeed/CrUX result was inferred from it.

## Verification and release state

- Initial live crawl: [81-page baseline](baseline-2026-10-13.json), all successful HTTP responses, 11 empty evidence pages, no homepage subject links.
- Current live crawl: [live audit](live-audit-2026-10-13.json), 66 sitemap URLs and 137 inspected pages, including one older page per subject, no issues reported by the verifier at that time. That live pass predates the added first-archive/WWW gates in verifier v2; rerun the current verifier after the final rollout. Sources change hourly, so these counts are a dated observation.
- Populated local production build: [crawl evidence](verified-local-crawl.json), 85 inspected pages and eight sitemap URLs using clearly labeled, isolated QA evidence. The eight URLs are a fixture result, not a proposed production sitemap size.
- Lint, typecheck, production build, 222 unit tests, isolated local Postgres storage checks, report checks, and GTM checks passed. The report check covers revision-aware sitemap dates; storage checks cover canonical query identifiers, full-window counts, topic pagination, classifier filtering, and archive readiness.
- Desktop 1440px, short desktop 756×469, and mobile 390×844 were inspected. Selected screenshots: [source dates on mobile](screenshots/source-dates-mobile.png), [short desktop map](screenshots/map-short-desktop.png), [Browse from Ask](screenshots/browse-from-ask.png), [topic schema](screenshots/topic-schema.png), and [report schema](screenshots/report-schema.png). Welcome and directory have no horizontal overflow; the directory is keyboard reachable. WebGL is absent before entry and mounts after entry. Dragging preserves map focus; orbit/zoom persist after easing. Ask closes back to its trigger and restores the topic panel at the short desktop size.
- WebGL-disabled Chrome was confirmed to return `null` for canvas WebGL contexts. Entry reaches the map fallback, region/source browsing works, and Ask remains usable. A separate WebGL-enabled browser verifies the 3D path.
- Schema.org validated Article (with SYMTRI authorship), CollectionPage, Dataset, BreadcrumbList, and WebSite with zero errors and zero warnings. Source details expose the stored first-seen date, while the local Postgres check confirms that lightweight list payloads omit it. The local crawler parses JSON-LD, compares collection names and visible links, checks dates, and validates canonical/indexing/link behavior. Google Rich Results Test returned “Something went wrong” rather than an eligibility result; no rich-result eligibility or appearance is claimed.
- The live alias resolved to Ready deployment `dpl_G1Q4YQHSQcDXVCG1PHr7PxwreAss` (`testimonio/symtri`) during verification. The live site changed while this task was active; this task did not issue a deployment. `npm run check:production` passed: zero embedding/classification/catalog backlogs, healthy monitor, matching live/snapshot relationship coverage. The latest run was partial because Hugging Face coverage was partial; that coverage limitation was retained.

The final worktree was reviewed and deployed with user authorization on October 13. Ready deployment `dpl_XDeEkdEhiwyXsrSzzSPSe7wWvYCZ` now serves `symtri.com`. Verifier v2 crawled 137 production pages with zero issues and 66 sitemap URLs; GTM and production health checks passed. First-archive dates, repository creation labels, visible SYMTRI report attribution and Organization author schema, WWW 308 with preserved query parameters, and Browse-from-Ask focus are verified live. Fresh lint, typecheck, 222 unit tests and isolated Postgres checks passed; Vercel rebuilt with production configuration. Existing newsletter/report work is included. No runtime error logs were found for this deployment during the release scan. The latest hourly run reports Hugging Face unavailable; monitoring is healthy with zero embedding/classification/catalog backlogs. See [principal review](principal-review.md), [release gate](release-gate.json), and [deployed crawl](deployed-crawl-2026-10-13.json).

## Reproduce the local checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run start -- --port 3107
npm run check:seo -- --report /tmp/symtri-seo.json
SYMTRI_CHECK_URL=http://127.0.0.1:3107 npm run check:gtm
```

For storage: `npm run test:storage:local` creates a fresh isolated cluster. On this machine the default PostgreSQL 14 binary has a missing ICU library; use `SYMTRI_PG_BIN=/opt/homebrew/opt/postgresql@17/bin npm run test:storage:local`. Do not rerun the migration test in a reused cluster: test roles are cluster-scoped and migrations are not all idempotent.

For populated browser fixtures, initialize a separate isolated loopback cluster with the storage/report checks, then run `scripts/seed-seo-fixtures.ts` with `SYMTRI_TEST_DATABASE_URL` pointing at that cluster. Use the same loopback URL as `DATABASE_URL` for the build and server. Never point fixture seeding at production. Fixtures are labeled as tests, publish no external content, and spend no Gateway tokens.

For deployed checks, set `SYMTRI_CHECK_URL=https://symtri.com` and use `npm run check:production` after the deployment reports Ready. Verify new behavior on that alias, not merely a prior Workflow deployment or a cached preview.

## Remaining dependencies and growth plan

No verified Search Console or Bing Webmaster Tools account access was available in the provided tools. Index coverage, search queries, impressions, CTR, positions, backlinks, and cross-platform AI citations are unmeasured. Search-enabled answer-engine accounts must provide observable results before populating citation/recommendation rates. [measurement.md](measurement.md) provides the procedure; the recorder’s smoke fixture is not a public search observation.

| Period | Prioritized work | Evidence of progress |
| --- | --- | --- |
| First 30 days | Verify the final rollout; submit sitemap in existing Search Console/Bing properties; run the fixed benchmark; inspect indexing exclusions and cold mobile performance; maintain source-grounded AI/software briefs | Correct deployed metadata and links; property exports; dated benchmark observations with missing providers explicit; route/device sample counts; retained sources for each published claim |
| Days 31–60 | Improve pages that show actual relevant impressions or repeated reader questions; add deeper original explanations or evaluations where source evidence supports them; prepare individually relevant outreach drafts | Useful page-specific answers, original artifacts, valid citations, improved exploration/source visits; outreach remains unsent until authorized |
| Days 61–90 | Compare equivalent benchmark periods and actual organic/AI referrals; expand to another evidence-rich cluster only if demand and coverage justify it; remove or consolidate pages that stay thin | Comparable query/page exports, citation URLs and denominators, audience actions, documented content decisions; no manufactured growth or ranking claims |

Do not mass-produce topic variants, fabricate credentials or endorsements, buy links, or publish unsourced comparisons. Do not send outreach, buy tools, or create external accounts without explicit authorization. `llms.txt` and other machine-readable bundles remain optional experiments; the implementation focuses on usable public HTML rather than treating them as ranking requirements.

Official guidance used: [Google AI features](https://developers.google.com/search/docs/appearance/ai-features), [structured-data introduction](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data), and [OpenAI search/training crawler controls](https://developers.openai.com/api/docs/bots). Installed Next.js documentation was consulted for metadata, sitemap, robots, JSON-LD, and font loading. Search/retrieval access is independent of training access; structural validity does not guarantee indexing, rich results, or AI citations.
