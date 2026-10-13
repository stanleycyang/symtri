# Growth attribution

Use utm_source: producthunt, hackernews, x, linkedin, newsletter, stanleycyang, or share. Use utm_medium: social, email, referral, or launch. Use utm_campaign: launch-2026-10 or signal-YYYY-WW. Optional utm_content identifies a copy variant.

Vercel Analytics records pageviews and named map, Ask, sharing, and outbound-source interactions. Never pass email addresses, Ask question text, or source titles as custom properties. Enable Web Analytics and Speed Insights in the linked Vercel project; custom events require a supported plan.

## Buttondown email list

The report signup form posts directly to Buttondown's hosted `symtri` subscription endpoint. Buttondown handles confirmation, unsubscribe, validation and spam protection; SYMTRI stores no email addresses and needs no signup API key. Keep this a native form submission so provider redirects and CAPTCHA challenges work. The owner account is verified.

The `newsletter_signup` event records initiation only, with edition and provider; never record the submitted email. It does not prove a confirmed subscription.

## Weekly briefing export

Run `npm run digest:build -- 2026-10-12T00:00:00Z` with DATABASE_URL and AI Gateway access configured. The end must be a completed Monday UTC boundary. It saves reviewed HTML, text and JSON under artifacts/digests. Editorial ranking and synthesis use bounded model calls and checked source passages, with reading-note fallbacks. Public page views do not generate reports.

Public editions are at `/signal`, with RSS at `/signal/feed.xml`. The authenticated Monday cron saves each completed UTC week once and skips weeks without checked evidence. Selection uses the full archived week and a bounded, day-stratified sample of readable notes. Snapshot coverage is reported separately. After publication, the cron creates one Buttondown draft when BUTTONDOWN_API_KEY is configured. Failed provider calls can be retried without rewriting the saved edition.

After reviewing the exported JSON, `npm run digest:publish -- artifacts/digests/signal-YYYY-WW.json` publishes that exact briefing. Existing briefings are immutable; a legacy reading-list edition can receive one reviewed archive-backed upgrade. `npm run digest:buttondown -- artifacts/digests/signal-YYYY-WW.json` also creates a draft from a reviewed export. The server key has email read/write only, with sending disabled. Existing drafts and sent editions are preserved. Review, preview and send from Buttondown; publishing a report never sends a newsletter.

## Vercel dashboard activation

In the `testimonio / symtri` project, enable Web Analytics and Speed Insights. Code is already installed; no alternate analytics provider is needed. Open `/` and `/ai/agents`, enter the map, select a region/thread, share a page, open and submit Ask, and follow a source. Confirm `enter_universe`, `select_region`, `select_topic`, `share` (point/channel), `ask_symtri_open`, `ask_symtri_submit`, and `outbound_source` (sourceId). Confirm `newsletter_signup` initiation on the weekly report; it must contain no email address.

Visit `https://symtri.com/ai/agents?utm_source=x&utm_medium=social&utm_campaign=launch-2026-10` to check campaign attribution. Vercel’s UTM dashboard filters require Web Analytics Plus or Enterprise; standard referrer data and campaign parameters are separate. See https://vercel.com/docs/analytics/filtering and https://vercel.com/docs/analytics/custom-events. Arbitrary query parameters and hashes are removed from analytics URLs; Ask text is never sent as an event property.

## Email UX

The briefing email starts with a compact brand masthead, UTC date range and
estimated reading time. Each checked finding appears once, followed by its
supported implication, an editorial next-step callout, the source caveat,
original-source links and a question linked to that exact web brief. Detailed
selection methodology stays on the website. HTML and plain text carry the same
findings, recommendations and caveats.

Buttondown is configured with sender name Symtri Signal, the Classic frame and
teal links (#246975). The template uses standard headings, paragraphs, blockquotes
and inline email-safe styles: 16px Arial with 1.65 line height, 24px story headings
and a pale callout background. It needs no custom-CSS plan upgrade, images,
JavaScript or web fonts. Inbox preview text lists the edition's developments.
Existing sent editions remain untouched, and sending remains manual.

Verification covers Buttondown's actual preview, a delivered Gmail test, and
phone-width rendering of the delivered HTML. This is not a full Outlook/Apple
Mail client matrix; future client-specific changes should be checked in those
clients before being claimed compatible.
