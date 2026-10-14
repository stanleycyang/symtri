# Demo production

This optional package keeps Playwright and Remotion out of the application install and production build. Use Node.js 24. Install `ffmpeg` and `ffprobe` on your system, then run from the repository root:

```bash
npm ci --prefix demo
npm exec --prefix demo -- playwright install chromium
npm run demo:check
```

For local recording, follow the [development configuration guide](../docs/development.md#data-and-deployment) and configure your own local archive with readable Agents sources; the database-free preview cannot supply the archive source list used by this walkthrough. Then start a production build in another terminal:

```bash
npm run build
npm run start -- --hostname 127.0.0.1 --port 3108
```

Record and export:

```bash
npm run demo:record
npm run demo:render
```

The recorder expects a usable real feed and an Agents source. Your local archive supplies a repeatable source set. To record the public deployment instead, set `DEMO_URL=https://symtri.com npm run demo:record`. Recording submits one public Ask request per viewport, subject to that deployment's quota and model budget. Do not use credentials or private content in footage intended for the public README.

The script records 1600 × 900 and 1080 × 1080 walkthroughs. It waits for feed readiness, explores AI → Agents, opens a real source, and asks about AI and energy. It fails on missing controls, browser errors, or an incomplete answer. Intentional reading pauses are part of the video; network timing and live evidence can vary. Captions use recorded step timestamps rather than assuming fixed load durations.

Playwright saves real WebM files. `prepare.mjs` copies them and their timing manifest into `demo/public/`, which is separate from the application's `public/`. Remotion adds title and end cards, then exports genuine MP4 files. FFmpeg creates the README GIF and rejects exports larger than 8 MiB.

Only publish reviewed final exports:

- `docs/demo.mp4`
- `docs/demo-square.mp4`
- `docs/demo.gif`

Raw recordings, the palette, and render inputs are ignored. App CI checks the optional package independently with its own lockfile; rendering and live recording remain explicit local commands.

Tool references: [Playwright video lifecycle](https://playwright.dev/docs/videos), [Remotion frame timing](https://www.remotion.dev/docs/use-current-frame), and [Remotion CLI rendering](https://www.remotion.dev/docs/cli/render). Tool dependencies retain their own licenses.

## Launch film

`npm run demo:launch` exports the 75-second launch film in wide, square, and vertical formats plus `docs/launch-poster.png`. It uses the reviewed production captures in `docs/launch-assets/`, so no live API calls or raw browser recordings are required to render. All copied inputs stay in ignored `demo/public/`. Wide layouts place the story beside the product; square and portrait layouts stack the copy above the product without cropping the source or Ask screens.

To refresh the product captures explicitly, run `npm run demo:capture:launch` (optionally set `DEMO_URL`). This opens an isolated Playwright browser, captures the map and AI threads, submits one real Ask question, follows its cited source, and captures the weekly Signal.

For a local target, set `DEMO_URL=http://127.0.0.1:3108` and configure populated archive data, working AI Gateway synthesis (`AI_GATEWAY_API_KEY` locally), readable source detail notes, and an existing published weekly Signal edition. A retrieval-only Ask result has no claims and cannot pass this capture; an archive alone does not supply the published briefing. The default target is `https://symtri.com`, which uses its deployed Gateway configuration.

The script rejects unfinished or uncited answers and browser errors. `provenance.json` records the actual source, question, origin, and capture time; screenshots retain the product's live content and counts.

Run one capture command at a time. Completed captures are copied to a sibling staging directory, then published with directory renames; reviewed files are never overwritten individually. A retained backup restores the previous set after a failed swap or on the next publication after an interruption. Review refreshed captures before committing them.

The 75-second edit runs: introduction (0–12s), overview and threads (12–27s), source detail (27–41s), cited Ask answer (41–56s), weekly Signal (56–65s), contributor invitation (65–69s), and closing card (69–75s). Native SVG constellation graphics are decorative, separate from actual product screens. The silent narrative is readable without audio; music fades in and out. The poster is taken from the map chapter.

The bundled music has its own attribution license. See [CREDITS.md](CREDITS.md); the rendered end card also retains the credit and notes the audio changes. Keep that attribution when sharing the exported film.
