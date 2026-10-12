# Growth attribution

Use utm_source: producthunt, hackernews, x, linkedin, newsletter, stanleycyang, or share. Use utm_medium: social, email, referral, or launch. Use utm_campaign: launch-2026-10 or signal-YYYY-WW. Optional utm_content identifies a copy variant.

Vercel Analytics records pageviews and named map, Ask, sharing, and outbound-source interactions. Never pass email addresses, Ask question text, or source titles as custom properties. Enable Web Analytics and Speed Insights in the linked Vercel project; custom events require a supported plan.

## Newsletter deferred

Newsletter signup and provider automation are intentionally absent. There is no signup form, subscription route, provider credential, newsletter database migration, or digest cron. Choose an affordable provider before adding capture or sending.

## Weekly digest export

Run `npm run digest:build -- 2026-10-10T14:00:00Z` with DATABASE_URL configured. It saves HTML, plain text, and selected evidence under artifacts/digests. No email is sent and the local export spends no model tokens.

The builder deduplicates daily samples, compares two seven-day periods, and reports missing snapshot days. Topic comparisons use saved samples; new connections compare full fourteen-day snapshot relationships. Do not describe these as full weekly topic counts.

An optional grounded intro helper remains available for future automation. It uses selected evidence, the existing model/support audit, and a deadline with a deterministic fallback. It is not scheduled or called by public routes.
