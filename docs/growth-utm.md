# Growth attribution

Use utm_source: producthunt, hackernews, x, linkedin, newsletter, stanleycyang, or share. Use utm_medium: social, email, referral, or launch. Use utm_campaign: launch-2026-10 or signal-YYYY-WW. Optional utm_content identifies a copy variant.

Vercel Analytics records pageviews and named map, Ask, sharing, and outbound-source interactions. Never pass email addresses, Ask question text, or source titles as custom properties. Enable Web Analytics and Speed Insights in the linked Vercel project; custom events require a supported plan.

## Newsletter deferred

Newsletter signup and provider automation are intentionally absent. There is no signup form, subscription route, provider credential, newsletter database migration, or email delivery. Choose an affordable provider before adding capture or sending.

## Weekly digest export

Run `npm run digest:build -- 2026-10-10T14:00:00Z` with DATABASE_URL configured. It saves HTML, plain text, and selected evidence under artifacts/digests. No email is sent and the local export spends no model tokens.

Public editions are at `/signal`; subscribe through `/signal/feed.xml` in an RSS reader. The authenticated `/api/digest` cron publishes each Monday at 14:00 UTC. It saves the last completed UTC week once and skips weeks without evidence. It sends no email and spends no model tokens.

The builder deduplicates daily samples, compares two seven-day periods, and reports missing snapshot days. Topic comparisons use saved samples; new connections compare full fourteen-day snapshot relationships. Do not describe these as full weekly topic counts.

An optional grounded intro helper remains available for future automation. It uses selected evidence, the existing model/support audit, and a deadline with a deterministic fallback. It is not scheduled or called by public routes.

## Vercel dashboard activation

In the `testimonio / symtri` project, enable Web Analytics and Speed Insights. Code is already installed; no alternate analytics provider is needed. Open `/` and `/ai/agents`, enter the map, select a region/thread, share a page, open and submit Ask, and follow a source. Confirm `enter_universe`, `select_region`, `select_topic`, `share` (point/channel), `ask_symtri_open`, `ask_symtri_submit`, and `outbound_source` (sourceId). Signup is intentionally absent.

Visit `https://symtri.com/ai/agents?utm_source=x&utm_medium=social&utm_campaign=launch-2026-10` to check campaign attribution. Vercel’s UTM dashboard filters require Web Analytics Plus or Enterprise; standard referrer data and campaign parameters are separate. See https://vercel.com/docs/analytics/filtering and https://vercel.com/docs/analytics/custom-events. Arbitrary query parameters and hashes are removed from analytics URLs; Ask text is never sent as an event property.
