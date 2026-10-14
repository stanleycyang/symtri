# Architecture

[← Project overview](../README.md) · [Development guide](development.md)

SYMTRI separates discovery, persistence, retrieval, and presentation. Public page views use the persisted archive once it contains signals; source APIs support the empty-archive and database-free preview paths.

## Find your way through the code

| Directory | Responsibility |
| --- | --- |
| `app/` | App Router pages, public subject/source pages, and API routes |
| `components/` | Universe experience, topic and source panels, Ask, and reports |
| `lib/data/` | Source adapters, normalization, classification, storage, catalog growth, and evidence |
| `lib/ai/` | Ask routing, retrieval integration, embeddings, generation, and support checks |
| `lib/newsletter/`, `lib/email/` | Newsletter preferences and export/provider integration |
| `workflows/` | Durable ingestion orchestration |
| `supabase/migrations/` | Versioned database schema changes |
| `db/` | Initial database schema and API lockdown |
| `scripts/` | Storage checks, production verification, evaluation, and operator tools |

## From observation to map

1. Bounded source adapters normalize source IDs, canonical URLs, timestamps, and text. Partial source failures retain successful observations.
2. Storage deduplicates canonical pages while keeping separate source observations and provenance. Retained evidence is stored separately from short map excerpts.
3. Classification assigns subjects. The workflow refreshes graph relationships, activity, the public feed, and daily snapshots, then processes bounded embedding work.
4. The map receives a capped overview. Topic and connection endpoints query matching archive evidence beyond that cap.
5. Ask routes mapped questions and searches the broader archive. Passage-backed claims receive a separate support check; missing or rejected evidence can produce an empty answer or a retrieval fallback.

[View the detailed application flow](symtri-flow.svg).

## Boundaries to preserve

- Source observations are not a census of internet activity. Co-classification does not establish causation.
- Live activity uses the full 14-day archive. The 300-detail rendering cap must not determine activity or relationship totals.
- Historical views use saved evidence rather than borrowing current sources.
- Secrets, source persistence, and model calls stay server-side. Local preview does not require production credentials.
- External text keeps its provenance and licensing metadata. The code license does not relicense source material.

Read [AGENTS.md](../AGENTS.md) for repository-specific implementation lessons and the [development guide](development.md) for detailed behavior and validation.
