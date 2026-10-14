# SYMTRI roadmap

SYMTRI is in active development. These are contribution directions, not promised release dates. For current work, check [open issues](https://github.com/stanleycyang/symtri/issues) and propose a focused change before starting a large implementation.

## What you can use today

- An interactive universe, topic browsing, and a WebGL fallback.
- Bounded source ingestion, a canonical archive, and independent source observations.
- Full-window activity and relationship counts, daily snapshots, and historical navigation.
- Archive retrieval, source-linked Ask, retained evidence, and support checks.
- Evidence-driven catalog growth and saved weekly briefings.

## Where contributions matter next

| Area | Useful contributions | Evidence of improvement |
| --- | --- | --- |
| Source quality | Fix missing coverage, parsing errors, or classifier false matches | Real source examples plus focused regression checks |
| Answer quality | Improve subject routing, retrieval, or empty-answer behavior | Positive and negative examples with passage support |
| Accessible exploration | Refine keyboard, touch, reduced motion, or fallback navigation | Production-browser verification at desktop and mobile sizes |
| Performance | Reduce scene or query cost while preserving evidence scope | Before/after measurements with a reproducible workload |
| Contributor experience | Improve setup, documentation, and local verification | A clean checkout can follow the documented steps |

## Proposing a larger direction

Describe the person it helps, the current obstacle, the smallest useful change, and how to evaluate it. New connectors must respect provider terms, bound requests, and preserve provenance. Changes to AI behavior should include unsupported-subject examples as well as successful answers.

Maintainers may refine scope during review. An issue label or this roadmap does not guarantee that a proposed implementation will be merged.
