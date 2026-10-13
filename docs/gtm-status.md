# GTM implementation status

SEO/AEO updates and current measured telemetry are documented in [the October 13 audit](seo/README.md). The newsletter and editorial-report notes below describe an earlier baseline; current implementation details are in [newsletter personalization](newsletter-personalization.md).

Newsletter signup and email delivery remain deferred. Vercel Analytics is the selected provider; the owner will enable it in the dashboard.

| Issue | Release scope | Remaining external step |
| --- | --- | --- |
| #12 Indexable pages | Seed and public catalog pages, hourly ISR, redirects, readable sources, full-window activity, canonical metadata, sitemap | Submit sitemap in Search Console |
| #13 Signup | Deferred; no form or subscription endpoint | Choose a provider later |
| #14 Sharing | Topic, region, connection, signal, and historical links; native share with clipboard fallback; topic-page share controls; specific titles and 1200×630 cards with activity windows, momentum where available, and source headlines | Social platforms control their preview caches |
| #15 Analytics | Vercel Web Analytics and Speed Insights; privacy-filtered URLs, map/Ask/share/outbound events; UTM conventions | Owner enables dashboard, then confirms pageviews and event properties |
| #16 About | Methodology, source/license scope, Ask limits, creator/GitHub links, weekly report navigation | None |
| #17 Structured data | Escaped WebSite/Person, AboutPage, Dataset, BreadcrumbList, report Article; full fourteen-day temporal coverage and actual activity values when available | Search engines decide indexing and presentation |
| #18 Digest | Automatic public weekly report, permanent archive pages, source links, share cards, RSS; authenticated Monday cron; immutable per-week JSONB records and empty-evidence protection | Email/provider drafts intentionally deferred |

Weekly reports cover the last completed Monday-to-Monday UTC week. Publication runs Monday at 14:00 UTC. Retries leave the saved edition unchanged. Topic comparisons use deduplicated saved samples; connections compare full-window snapshot aggregates. The report explicitly states missing-day coverage. Publication uses deterministic source-grounded copy without a model call or provider dependency.

Verification commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:storage:local`, and `SYMTRI_CHECK_URL=https://symtri.com npm run check:gtm`. The storage runner includes report JSONB, idempotency, RLS, authentication, empty-evidence, and completed-week checks.

See `docs/growth-utm.md` for attribution and dashboard activation. There is no email sending or subscription route.
