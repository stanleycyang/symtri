# GTM implementation status

Newsletter signup and provider automation are deferred at the owner's request. No newsletter provider account or migration is needed for this release.

| Issue | Release scope | Follow-up |
| --- | --- | --- |
| #12 Indexable pages | 10 region pages and 66 thread pages, hourly ISR, public catalog and merged-ID redirects, readable sources, activity, sibling/connection links, canonical metadata, 78-entry sitemap | Sitemap submission |
| #13 Signup | Deferred; no form or subscription endpoint | Select an affordable provider |
| #14 Sharing | Canonical topic URLs; connection/signal/day map links; native share and clipboard; point-specific OG images and query metadata; archive lookup | External social unfurl inspectors |
| #15 Analytics | Vercel Analytics and Speed Insights, interaction events without question text or email, UTM conventions | Dashboard activation and event/attribution verification |
| #16 About | Methodology, source/licenses, Ask limits, GitHub and creator referral links, map/entrance navigation | Content review |
| #17 Structured data | Escaped WebSite/Person, AboutPage, Dataset and BreadcrumbList JSON-LD | External rich-result/schema validation |
| #18 Digest | Provider-independent HTML/plain-text/JSON export, snapshot comparisons, top signals, sample growth, quiet topics, full-window connections; optional grounded intro helper | Sending and scheduled provider integration deferred |

Validation includes unit tests, lint, typecheck, production build, isolated PostgreSQL checks, a smoke check across all 78 sitemap URLs, and production browser inspection. Local About and Agents Lighthouse checks scored 100 for accessibility and SEO. Production verification is performed during release.

See `docs/growth-utm.md` for attribution and the local digest export command. There is no email sending or newsletter cron in this release.
