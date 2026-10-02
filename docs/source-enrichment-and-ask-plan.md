# Source enrichment and Ask improvement plan

## Product outcome

Give visitors something useful to read at each map stop: what happened, why it
matters, what the evidence actually supports, and where to explore next. More
source volume alone does not deliver that outcome.

This document defines the implementation and verification requirements. Symtri has
classification, canonical deduplication, source observations, persisted archive
search, embeddings, organic concepts, RSS discovery, and request-time Ask
synthesis. The enrichment stage retains source evidence and caches source-backed reading notes.

## Free source candidates

Free access does not imply unrestricted republication. Keep attribution and
content-specific reuse metadata with retrieved evidence; use supported APIs and
feeds, bounded requests, and cached results.

| Candidate | Visitor value | Integration approach | Priority |
| --- | --- | --- | --- |
| [NASA news](https://www.nasa.gov/rss-feeds/) and [JPL](https://www.jpl.nasa.gov/rss/) | Readable mission and science updates beside technical papers; potential visual entry points | Deliberately register a small feed selection in the existing RSS system. Start with text; add images only with credit and reuse metadata. | First |
| [CISA Known Exploited Vulnerabilities](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) | Concrete security evidence: affected product, known exploitation, required action | Poll the public JSON catalog, diff by CVE and changed fields, and preserve date-added separately from vulnerability disclosure date. | First |
| [Europe PMC](https://europepmc.org/RestfulWebService) | Better biology and medicine coverage, structured abstracts, research context | Bounded subject queries; deduplicate against OpenAlex by DOI and other stable publication IDs. Use permitted full text selectively, and distinguish preprints from journal articles. | Second |
| [Hugging Face Hub](https://huggingface.co/docs/hub/api) | Discover models, datasets, and usable demos linked to papers and code | Public metadata and model/dataset cards. Separate new releases from updates, filter duplicates and low-information uploads, retain declared license and limitations. Metadata access does not imply free inference. | Second |
| [Wikipedia text extracts](https://www.mediawiki.org/wiki/Extension:TextExtracts) | A concise explanation of unfamiliar terms before reading recent research | Background enrichment, separate from current observations. Resolve ambiguous entities, cache introductions, retain page/revision attribution, and follow [API limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits). | Second |
| [World Bank Indicators](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation) | Quantitative context for energy and markets, such as renewable-electricity share | Fetch a curated set of series on a slow schedule. Preserve units, geography, reporting period, and retrieval date; annual observations must not appear as hourly news. | Later |

OpenAlex is already integrated. GitHub is already integrated but can supply more
value through selected README sections and release notes. Those are enrichment
of existing sources, rather than new integrations.

RSS discovery currently depends on repeated Hacker News links to a domain.
Deliberate source selection should complement it so underrepresented subjects
can gain coverage without first becoming popular on Hacker News. Avoid turning
the archive into a second copy of the same technology discussion feed.

## Persist useful reading material

Display summaries remain short. Explanation and search must use retained source
text when available, while a title-only item or discussion placeholder supplies
no evidence for unreported findings.

The durable enrichment queue runs after signal persistence:

1. Retain original structured abstracts and useful source metadata separately
   from the short display summary. Preserve source text, provenance, retrieval
   time, and a content hash.
2. Prefer structured evidence: paper abstracts, public repository READMEs and
   release notes, model cards, and feed content. For Hacker News links, resolve
   known GitHub/arXiv destinations through their adapters before attempting
   bounded public article extraction. Reuse the existing public-fetch protections.
3. Produce an expandable reading note: a plain-language explanation, two or
   three supported facts, why those facts may matter, and an explicit limitation.
   Each factual claim references an evidence passage. Omit unsupported fields;
   a title-only item remains a discovery link rather than an invented explanation.
4. Add two meaningful next steps: an evidence-backed related story and a
   question users can ask about this story. Preserve original-source access.
5. Cache by source-content hash and enrichment version. Keep failures separate
   from source-fetch status, retry within a bounded budget, and never block signal
   persistence or the map on model availability.

The initial cap is 25 high-value or thin-summary stories per hourly
run, selected across subjects and sources. Adjust after measuring actual token
cost, evidence quality, and queue growth. Enrichment and embeddings still incur
compute/model costs even when source APIs are free.

Keep evidence retrieval, enrichment, and presentation distinct. Embeddings
should use retained evidence, not just generated prose. Wikipedia context must
remain labeled background; publisher claims and community discussion must not
be promoted into independently verified findings.

## Improve Ask in this order

### 1. Fix intent and relevance before expanding generation

Detect update, explanation, comparison, connection, and follow-up requests.
Extract subjects separately from task words such as "compare" and "limitations".
Retrieve evidence for both sides of a comparison; do not require every document
to contain both sides and the instruction word.

Keep map navigation as a result of retrieval. An early region or child match
must not prevent a question from reaching relevant full-archive evidence.
Preserve current-classifier filtering, active-source visibility, snapshot scope,
and explicit empty results when evidence is insufficient.

For connection questions, require evidence about the requested relationship.
Being tagged to AI and Energy does not establish an AI/data-center/nuclear-power
connection. Nuclear weapons or nuclear-site earthquakes need negative examples
beside positive civil-power examples in classification and Ask tests. If changing
classification, bump the classifier version and verify reclassification backlog.

### 2. Require support for each claim

Source-ID membership and output length do not establish support. Returning valid
IDs alone must not qualify an answer as grounded; exact source passages and a
separate support audit are required.

Generate structured claims with supporting passage references, then render
inline citations. Reject unsupported claims and preserve all evidence necessary
for displayed claims. A statement that a discussion alleges a problem must
remain an attributed allegation unless additional evidence establishes it.

Only allow cross-region synthesis after the relevance and grounding checks
pass. Preserve the distinction between conceptual map routes, co-classification,
and evidence of a real-world relationship.

### 3. Support continued exploration

Pass a bounded previous question and answer context plus the selected map
location when asking a follow-up. Resolve "their" or "that" against that context;
ask a brief clarification when no subject is available. Treat context as untrusted
input and retain body-size, rate-limit, and output-cost controls.

Provide a short initial answer with an expandable explanation, source excerpts,
and two evidence-grounded follow-up questions. Add streaming only after answer
quality is reliable; use an overall response deadline and make retrieval/model
fallback status understandable.

## Acceptance cases

These cases capture durable failure modes found during the live review. Exact
stories and counts vary, so use seeded fixtures for automated assertions.

| Question or situation | Required behavior |
| --- | --- |
| "What's happening with AI agents?" | A useful update with direct supporting evidence and a relevant map location. |
| "What is new in exoplanet research?" | Relevant archive papers even without a recognized map alias; distinguish preprints and avoid broad trend claims. |
| "Compare coding agents and language models" | Retrieve each subject separately and compare only supported dimensions; task words must not exclude evidence. |
| "What connects nuclear energy and AI?" | Cite direct civil-power/data-center evidence or disclose its absence. Do not substitute military nuclear stories, earthquakes, or an arbitrary AI project. |
| "What are their limitations?" after a comparison | Resolve the prior subjects. In a fresh session, clarify instead of searching for arbitrary limits. |
| A generated note mentions three sources but cites one | Remove unsupported claims or attach valid support to each claim; citation-ID membership alone cannot pass. |
| "What is new in battery recycling?" | Search the full archive for the subject and return an honest empty answer when no evidence qualifies. |
| Relevant evidence older than the overview cap | Remain reachable through Ask while respecting the requested time scope. |
| Enrichment unavailable or title-only evidence | Keep discovery usable without presenting fabricated reading notes. |

Use focused unit fixtures for intent, relevance, and claim validation; local
Postgres tests for archive retrieval and evidence outside the overview cap; and
a small scored production sample for answer quality. Review source relevance,
claim support, useful information, empty-answer correctness, and latency
separately. Existing passing tests are necessary but do not measure all of these.

## Implementation choices

The curated NASA and NASA JPL feed adapters share canonical normalization and
storage with the other sources, and have explicit source-catalog identities.
Automatic RSS discovery remains available for additional domains. The JPL
selection uses NASA-hosted JPL releases when the direct JPL feed is unavailable.
Reading notes retain the original source link and display nearby archived ideas
from the existing related-source lookup, alongside two source-specific questions.
Ask reserves retained evidence across sources within its 14-day topic window;
chronological topic browsing remains separate from answer ranking.
