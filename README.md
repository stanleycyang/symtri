# SYMTRI

**The Internet Is Thinking.** An interactive 3D map of technology attention.

## Current state

The universe has 10 stable regions, 66 subtopics, ambient and incoming signal particles, curved relationships, distance-based detail reveal, persistent orbit and zoom, hover highlighting, a cinematic entrance, and a region → subtopic → signal exploration path. It begins with simulated activity, then uses observed sample counts when the Hacker News, GitHub, and arXiv feed loads. Region panels expose recent signals that do not fit a named subtopic; topic panels show matching real signals with source links. Topics with no matching live events clearly show simulated examples.

## Run locally

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:3000>. Drag to orbit, scroll to zoom, click a region to focus, and select a subtopic to reveal signal markers. Escape or the back button returns outward.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

To verify the Postgres path with PostgreSQL and pgvector installed locally, run `npm run test:storage:local`. It starts a temporary loopback database, applies all migrations, checks API table protection, signal upserts, embedding cache and retrieval, relationships, and snapshots, then removes the database. For an existing isolated local database, set `SYMTRI_TEST_DATABASE_URL` to its loopback connection string and run `npm run test:storage`; that command rejects non-local hosts.

## Interaction QA

After a production build, check that the entrance button is visible and usable in a short desktop window (756 × 469 px) and a short phone viewport (390 × 480 px). The entrance should show the map's motion without region labels crossing the headline; entering should reveal those labels. Then focus AI, select Agents, open a signal, and use Escape to return outward. Drag and scroll after the entrance animation finishes; the camera must keep the visitor's chosen view. While focused, drag from empty space and from a node; neither drag should navigate away. A deliberate empty click or tap should return to the overview. Check that subtopics appear as the camera approaches a region, and that the mobile region selector and detail sheet remain usable at 390 px width. Open Ask Symtri, try both example questions, confirm the camera follows the answer, and verify the linked sources and the mobile panel. On mobile, the focused region and any selected route stop should remain visible below the Ask panel; closing it should restore the normal topic view. When two database snapshots exist, switch dates in the timeline, inspect a historical signal, return to NOW, and check timeline placement beside a focused region on mobile. On a slow connection, confirm the loading label appears while the header and map stay on the current date; they should switch together when the snapshot arrives. Returning to NOW before it arrives must keep the live map visible even if the old request finishes later.

With a live feed, focus a region containing signals without a named thread. Open one from RECENT SIGNALS, check its source link, and return to the region. On mobile, verify the thread list remains reachable by scrolling the panel.

For a repeatable frame pacing check, use a hardware-backed browser on the target device. After entering and letting camera motion settle, run this in DevTools in both the overview and a focused region. Repeat while orbiting and zooming. Headless Chrome results are useful smoke checks but do not establish real-device performance.

```js
const frameTimes = [];
await new Promise((done) => {
  const start = performance.now();
  let previous = start;
  function sample(now) {
    frameTimes.push(now - previous);
    previous = now;
    if (now - start < 4000) requestAnimationFrame(sample);
    else done();
  }
  requestAnimationFrame(sample);
});
console.log({ fps: frameTimes.length / (frameTimes.reduce((sum, ms) => sum + ms, 0) / 1000), slowFrames: frameTimes.filter((ms) => ms > 33).length });
```

## Implementation plan

1. **Universe and polish:** Keep the entrance and map visually coherent, tune camera paths and labels, check desktop and touch navigation, and measure frame rate on target hardware.
2. **Real signals:** The three source adapters, normalization, classification, and deduplication are implemented. Wire up the database and scheduled ingestion, then drive activity from persisted observations.
3. **Semantic layer:** Ingestion can embed new or changed signals and stable topic descriptions when `OPENAI_API_KEY` is set. Topic similarity adjusts the brightness of established map links, and Ask can use matching stored event vectors to rank sources within a detected region. Calibrate with real production embeddings while keeping region positions stable.
4. **Time and intelligence:** Daily sampled snapshots and timeline navigation are implemented. Ask Symtri routes a question through the current or historical sample, highlights a map path, and shows source-backed signals. Its optional model synthesis needs live credential verification and answer evaluation; production history also needs multiple successful ingestions.

## Data and deployment

`/api/signals` fetches a recent sample from the three sources. Only signals classified into at least one map region enter the feed; filtering happens before deduplication and the 150-signal cap so unrelated stories cannot displace mapped ones. Its response is uncached, while upstream source requests are cached for 15 minutes. The open map refreshes every 15 minutes and when a hidden tab becomes visible. If all sources fail and a database is configured, it serves recent archived signals. The map labels archive, partial live, and simulated states. This is a sample feed, not a complete count of internet activity.

Once a feed loads, region counts show classified events **in that sample**. Region brightness, cloud density, and incoming particles follow a score that weights topic relevance, source importance, and a 24-hour exponential decay. “Rising” compares weighted events from the latest 24 hours with the preceding 24 hours; it does not claim a platform-wide growth rate. Region positions stay fixed so the map remains learnable. Before the feed loads, the simulated universe remains visible.

Connections between regions brighten when the same sampled signals match both. A new connection appears after two shared signals, and the region panel links to related regions with the observed shared count. Those counts are co-classification evidence. When current topic embeddings exist, cosine similarity adds a restrained brightness adjustment to the established links only; it does not move regions or create new links. Historical snapshots use their recorded co-classification without today's semantic adjustment.

Each successful daily ingestion stores a snapshot of that day's sampled feed. A same-day retry replaces a snapshot only when it has at least as many available sources and mapped events, so an outage or sparse retry cannot reduce that day's coverage. Partial and archived samples are labeled in the map, including on mobile. After two dates exist, a timeline lets visitors compare region energy, relationships, and event details across those dates or return to NOW. Signal ages in a historical view are relative to when that snapshot was captured. A topic with no historical match shows an empty state instead of simulated events. The first real comparison requires two successful daily ingestions; a local database can be seeded to exercise the interface during development.

Ask Symtri uses deterministic topic matching to identify a region, flies to it, highlights a path across regions, and links source events from the current or selected historical sample. Nuclear energy and AI questions trace a curated conceptual route through Nuclear, Power Demand, and AI Infrastructure; the route is labeled as conceptual, while the summary separately states whether sampled signals support the connection. Route stops can be selected to fly to each subtopic. When both `DATABASE_URL` and `OPENAI_API_KEY` are configured, it embeds the question and uses matching stored event vectors to help rank sources within that region. It ignores vectors whose input text differs from the feed being answered and falls back to term ranking when semantic retrieval is unavailable. With `OPENAI_API_KEY`, a direct single-region answer can also synthesize a short note from the displayed sources through the Responses API. The server requires valid cited source IDs and falls back to the sample note when the model fails or evidence is broader than the asked thread. Cross-region and unsupported connection answers retain their explicit evidence caveats.

For persistence, create a Supabase Postgres project, run [db/001_signals.sql](db/001_signals.sql), [db/002_embeddings.sql](db/002_embeddings.sql), and [db/003_lock_down_api.sql](db/003_lock_down_api.sql) in order, and set `DATABASE_URL` to its transaction pooler connection string. The third migration enables row level security with no API policies; the app reads and writes through its server-side Postgres connection. Set a random `CRON_SECRET` of at least 16 characters in Vercel. The [Vercel cron schedule](vercel.json) calls `/api/ingest` once daily at 12:00 UTC; the route requires `Authorization: Bearer <CRON_SECRET>` and upserts normalized events by stable ID. When `OPENAI_API_KEY` is present, ingestion batches new or changed text through OpenAI's `text-embedding-3-small` model at 256 dimensions and stores the vectors in pgvector. An embedding failure does not discard the signal snapshot. `GITHUB_TOKEN` is optional and can improve GitHub API headroom. See [.env.example](.env.example) for variable names; never commit real values.

When setting `CRON_SECRET` through the Vercel CLI, remove the final newline from piped input; Vercel rejects whitespace in the cron authorization header. For a new secret: `openssl rand -hex 32 | tr -d '\n' | vercel env add CRON_SECRET production --sensitive --scope testimonio`. Use `--force` only when replacing an existing value.

The live sample and grounded Ask navigation work without these variables. The production database is the Supabase `testimonio/symtri` project in `us-east-1`, with all three migrations applied. Production snapshot history needs multiple daily ingestions before it can be compared across dates. The real embedding API path, semantic edge calibration, embedding-assisted Ask retrieval, and model summary quality remain unverified with production credentials. The Vercel project is `testimonio/symtri`, connected to `stanleycyang/symtri` for deployments from Git pushes. Both `symtri.com` and `www.symtri.com` are assigned to it.

Before production ingestion, confirm access to the intended Supabase project and confirm `DATABASE_URL` and `CRON_SECRET` are set in the Vercel project. If either is missing, finish database setup first; repeating ingestion commands will not resolve missing credentials. Never print secret values during these checks.
