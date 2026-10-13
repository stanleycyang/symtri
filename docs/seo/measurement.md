# Search and answer-engine measurement

Use `query-benchmark.json` as the fixed set of 25 queries. The initial focus is developers and researchers investigating AI agents, coding agents, and related software tooling. Priority is an editorial hypothesis; keyword volume, rankings, and citation rates have not been measured through Search Console or account-specific answer engines.

## Repeatable procedure

1. Run the exact benchmark queries in Google and Bing, and in the available search-enabled ChatGPT, Perplexity, Gemini, Claude, or Copilot interfaces. Record date, locale, sign-in state, model/version when visible, and whether web search was enabled. Do not silently replace an unavailable platform with an API model answering without search.
2. Save a screenshot, result URL, or response artifact. Inspect the full response and actual links. A brand mention is different from a linked citation; a citation is different from recommending SYMTRI as a destination. Retrieved pages are only observable when the platform exposes them.
3. Record each outcome as `true`, `false`, or `null`. `false` means the complete observed result lacked the outcome. `null` means unavailable or unmeasured. Search-result absence does not prove that a URL is unindexed.
4. Keep three observations per query/platform at consistent weekly intervals, initially using the same locale and sign-in settings. Separate branded queries from nonbranded discovery queries. Save competitor source URLs and which SYMTRI URL was cited. Review content relevance, not only whether the brand appears.
5. Compare against the previous comparable period. Report numerators and denominators, dates, providers, and missing observations. Repeated responses are correlated; a small change is not proof that an implementation caused the result. Change a benchmark question only through a versioned update.

## Record an observation

Create a JSON file with this shape, replacing the example with a real observation:

```json
{
  "queryId": "q01",
  "provider": "chatgpt",
  "observedAt": "2026-10-13T18:00:00Z",
  "locale": "en-US",
  "model": null,
  "signedIn": true,
  "searchEnabled": true,
  "rank": null,
  "retrieved": null,
  "cited": null,
  "mentioned": null,
  "recommended": null,
  "citedUrls": [],
  "competitorUrls": [],
  "evidence": "Path to the saved response or screenshot",
  "notes": "Unmeasured example; replace with the actual result."
}
```

```sh
npm run benchmark:record -- --input /path/to/observation.json --output /path/to/search-observations.jsonl
```

The recorder checks query IDs, timestamps, outcome types, and citation URLs. It excludes unmeasured outcomes from rate denominators. Its printed summary covers the supplied file, so use separate files for comparable time periods and providers. Store only public response evidence; omit personal search history and private account details. The smoke-test fixture used during development is not included in public outcomes.

## Traffic and visitor actions

Search Console: verify the domain property, submit `https://symtri.com/sitemap.xml`, and export page/query clicks, impressions, CTR, position, indexing reasons, and mobile Core Web Vitals. Bing Webmaster Tools: verify the same canonical domain and inspect sitemap/crawl/index reports. No verified access to either account was available during this audit; these measurements remain unknown.

Vercel Web Analytics and Speed Insights are active on the linked `testimonio/symtri` project. Existing events cover map entry, region/thread selection, Ask opening/submission, sharing, source clicks, and newsletter interactions. Treat source visits and successful exploration as useful actions; a signup event does not by itself prove a confirmed subscription.

The existing production sample is recorded in `field-baseline-2026-10-13.json`. It includes only 15 homepage LCP samples and can include test traffic. Do not infer broad mobile health or organic growth from it. Referrer data exposed only a blank hostname in this window; that is not evidence of zero AI referrals or zero organic discovery.

For each weekly measurement, export referrals and events alongside total pageviews. Referrer suppression means some AI visits can appear direct. Attribution is observed traffic, not proof of citation or recommendation. Google AI features contribute to normal Search Console web-search reporting; an AI-only breakdown is not established by these exports.

Read-only Vercel examples (verify project and team first):

```sh
npx vercel whoami
npx vercel project inspect --non-interactive --scope testimonio
npx vercel metrics vercel.speed_insights.lcp_ms -a p75 --prod --group-by route --since 7d --scope testimonio --project symtri --format json
npx vercel metrics vercel.speed_insights.inp_ms -a p75 --prod --group-by route --since 7d --scope testimonio --project symtri --format json
npx vercel metrics vercel.speed_insights.cls -a p75 --prod --group-by route --since 7d --scope testimonio --project symtri --format json
npx vercel metrics vercel.analytics.event.count --prod --group-by eventName --since 7d --scope testimonio --project symtri --format json
```

Check sample counts and device segments before comparing p75 values. Keep Lighthouse lab LCP/TBT separate from field LCP/INP. Target field p75 LCP ≤2.5 s, INP ≤200 ms, and CLS ≤0.1; investigate individual routes and mobile samples that exceed them.

## Content and authority plan

- Publish useful weekly briefs from checked original source evidence. Share the specific finding, source type, caveat, reporting period, and reproducible counting method. Prefer a precise developer question over a generic “best AI tools” list.
- Make the most useful archived connections and developments easy to cite. Link to original publishers and distinguish shared classification from causal inference. Never imply a preprint has been peer reviewed.
- Prepare relevant, individually researched outreach drafts for project maintainers, researchers, and technical communities. Offer a useful sourced finding or a correction opportunity. Send nothing without explicit authorization; avoid bulk forum promotion, bought links, invented endorsements, and fabricated author credentials.
- Expand beyond AI/software after actual queries, retained evidence, and recurring reader questions justify the next subject. Three readable sources is a publication quality floor, not a Google rule or proof of demand.

Official references: [Google AI features](https://developers.google.com/search/docs/appearance/ai-features), [Google Search Essentials](https://developers.google.com/search/docs/essentials), and [OpenAI crawler controls](https://developers.openai.com/api/docs/bots). Training access and search/retrieval access are separate. Public text and links remain the primary discovery surface; optional machine-readable files would need their own measured experiment.
