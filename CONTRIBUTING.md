# Contributing to SYMTRI

Help make technology research, projects, and discussion easier to explore. Code, documentation, reproducible bug reports, accessibility feedback, and classification examples all count as contributions.

## Your first contribution

1. Try [SYMTRI](https://symtri.com) and read the [architecture overview](docs/architecture.md).
2. Browse [open issues](https://github.com/stanleycyang/symtri/issues). Issues labeled [`good first issue`](https://github.com/stanleycyang/symtri/labels/good%20first%20issue) are intended to have a small, clear scope; availability varies.
3. For a substantial change, open an issue first with the use case and a proposed approach. For a small typo or focused fix, a PR is welcome directly.
4. Fork the repository, clone your fork, and create a descriptive branch, such as `fix/topic-keyboard-focus`.

If you need help, include the command you ran, the output with secrets removed, and your Node.js version in an issue. Follow our [community standards](CODE_OF_CONDUCT.md).

## Local setup

Use **Node.js 24** and npm. The `.nvmrc` file supports `nvm use` if you use nvm.

```bash
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Public-source preview runs without credentials or a database; provider availability can affect its feed. AI synthesis, persistence, and hourly workflows require the optional server configuration in [.env.example](.env.example) and the [development guide](docs/development.md#data-and-deployment).

Never use production credentials for a contribution. Never commit secrets, database dumps, or private source material. Report vulnerabilities through [SECURITY.md](SECURITY.md).

## Find the relevant code

See the [architecture code map](docs/architecture.md#find-your-way-through-the-code). Read [AGENTS.md](AGENTS.md) before changing behavior; it records lessons about this Next.js/React setup, scene interaction, source ingestion, retrieval, and database writes. For Next.js changes, read the relevant installed guide in `node_modules/next/dist/docs/` before writing code.

## Validate your change

For application changes, run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Run `npm run audit:deps` when changing dependencies. Fork PR CI uses no repository secrets and checks types, lint, unit tests, and the production build. A passing build does not replace browser or storage verification.

| Change | Additional verification |
| --- | --- |
| Docs or GitHub templates | Check links, commands, and rendered formatting |
| Map, labels, navigation, or panels | Production build in a browser at 1440px desktop, 756 × 469 short desktop, and narrow mobile; check drag versus click, orbit/zoom, Tab, and Escape |
| Classification or Ask routing | Positive and negative regression cases; bump `CLASSIFIER_VERSION` for classifier changes |
| Storage, migrations, or retrieval | `npm run test:storage:local` with local PostgreSQL and pgvector installed |
| Growth or query scaling | `npm run test:scale:local` when relevant |

The storage scripts create an isolated loopback database. `npm run test:storage` rejects non-local hosts. See [development checks](docs/development.md#checks) for details and [interaction QA](docs/development.md#interaction-qa) for the full browser checklist.

## Adding a source or fixing classification

Keep fetching bounded and respect provider terms and rate limits. Normalize stable source IDs, canonical URLs, publication times, titles, and useful summaries. Preserve separate observations when connectors find the same canonical page. Keep unmatched items in the archive.

Update source types and availability, database checks on both signal tables, visible labels, related-signal ID validation, local storage checks, and focused source tests. Document optional credentials using names only. Include a real source example and negative classification examples so a broader match does not silently misclassify unrelated stories.

## Open a pull request

Use a descriptive title and explain the problem, resulting behavior, and verification. Keep the PR focused. Include screenshots for visible changes and real examples for source/retrieval changes. Describe migration order and rollout requirements for schema changes.

CI and maintainer review may request changes. Explain unresolved limitations plainly; there is no guaranteed review timeline. Contributors retain credit through Git history and the PR conversation. Do not add unrelated formatting or generated artifacts.

Contributions to SYMTRI code are released under the [MIT license](LICENSE). Only submit material you have the right to contribute; third-party source text keeps its own applicable terms.
