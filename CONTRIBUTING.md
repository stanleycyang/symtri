# Contributing to SYMTRI

SYMTRI grows by adding reliable sources and making their connections useful to explore. Issues and pull requests are welcome for connector coverage, classification quality, retrieval, accessibility, performance, and the map experience.

## Before you start

- Search existing issues and open a focused issue for a substantial change.
- Never commit credentials, database dumps, or private source material. Use `.env.example` for variable names only.
- For a security issue, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Local setup

Use Node.js 22 or newer and npm. Run `npm ci`, then `npm run dev`. The site can render with direct public sources without a database. To exercise persistence and hourly ingestion, provide a local PostgreSQL instance with pgvector and the variables described in [README.md](README.md). Never point local storage tests at production; the test scripts reject non-loopback database hosts.

Before submitting a change, run:

```bash
npm run typecheck
npm run lint
npm run audit:deps
npm test
npm run build
```

Storage changes should also pass `npm run test:storage:local`. Growth or query changes should pass `npm run test:scale:local` when practical.

## Adding a source

Keep fetching bounded and respect the source's terms and rate limits. Normalize a stable source ID, canonical URL, publication time, title, and useful summary; preserve provenance and reject unsafe links. Store distinct observations even when two sources refer to one canonical page. Update source types, database checks, labels, and the focused source tests. A connector should not need a secret to browse public data unless its provider requires one; document optional credentials without including values.

## Pull requests

Explain what changed, why it matters for exploration, and how you verified it. Include screenshots for UI changes and an example source for ingestion changes. Keep migrations additive and describe how an existing deployment should apply them.

Contributions are released under the [MIT license](LICENSE).
