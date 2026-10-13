# Reader-directed newsletter personalization

## Plan

1. Store confirmed node IDs and meaningful exploration locally. A visible node
   held for at least eight seconds becomes a suggestion; hovering, time travel,
   hidden tabs and aborted navigation do not. Keep at most 20 recent nodes for
   30 days. Confirmed interests stay until changed.
2. Let readers search the current map catalog, select up to five interests and
   choose one lead interest. Suggestions are labeled and require confirmation.
   No interests means the broader briefing. Transfer confirmed choices only.
3. Capture `symtri_nodes`, `symtri_primary` and `symtri_primary_name` through the
   native Buttondown form. Keep provider confirmation and spam protection.
4. Generate bounded source-backed editions per lead node from the full completed
   week. Reuse checked reading notes; exact thread matches cannot borrow stories
   from their parent region. Include at most two main picks and one connection
   only when the same source matches another confirmed interest.
5. Use Buttondown's subscriber metadata conditions at send time. Preserve a
   broader edition for readers without interests and a quiet-week message for
   interests without suitable picks. Sending remains manual.
6. Verify local storage, selection, quiet and bridge cases, input escaping,
   provider metadata and actual per-reader previews. Deploy only after checks.

## Boundaries

Exploration is a suggestion, not a subscription change. This version does not
infer that a reader has read a story or received an earlier edition. A later
"worth revisiting" feature needs verified delivery history. Local choices do
not automatically synchronize across devices. Re-submitting the form with the
same email updates Buttondown's saved interests; this was verified against the
existing confirmed owner subscription. Browsing alone never updates them.

## Verification

- Production signup captured the exact Agents and Databases IDs, with Agents as
  the lead. Re-submitting updated the existing confirmed owner account.
- The production job completed with HTTP 200 against 13,519 archived sources.
  Selection version 2 built 62 node editions, prioritizing model-written findings
  and implications before recency. Missing evidence and rejected topic mismatches
  remain quiet. This supplement preserves the public report's saved editorial.
- Buttondown rendered the actual owner's personalized edition, a quiet Product
  edition, and the broader edition with empty preferences. Owner preferences were
  restored to Agents and Databases afterward.
- The owner-only delivered preview had the personalized subject, clean plain-text
  preheader, two expected sources, and no unresolved template expressions. Its
  source link opened the exact archived paper on the map.
- Desktop, short desktop and mobile signup checks passed. Escape restored focus
  to the invitation without leaving the selected node. The delivered email was
  inspected at 390px. All 221 unit tests, lint, production build, isolated Postgres
  checks and production health checks passed.

Buttondown does not evaluate conditions in its description field. Keep that
preheader plain text; subject/body personalization is verified. Editing subscriber
metadata in its dashboard requires both **Done** and the subscriber's **Save**.

## Selection repair — version 3

Personalized candidate ranking uses the current classifications from the full
weekly archive, rather than stale stored topic assignments. Each node retains
at most six valid candidates. Missing evidence, unsupported passages, and
editorial rejections trigger sequential six-row refill batches, scanning at
most 48 candidates per node across eight reads. Nodes stop scanning when their
pool is full or their ranked evidence is exhausted. The bounded sample does
not establish that the complete archive has no relevant evidence.

The personalization version is bumped to 3 so the next report retry rebuilds
older supplements while preserving the published public briefing and its
publication time. Existing Buttondown drafts remain unchanged and require
manual review; this fix never sends email.

Isolated PostgreSQL regression checks cover refill after six rejected rows,
new and removed current-classifier matches, and rebuilding a saved older
supplement without rewriting the public edition.
