# Demo production

This optional package keeps Playwright and Remotion out of the application install and production build. Use Node.js 24. Install `ffmpeg` and `ffprobe` on your system, then run from the repository root:

```bash
npm ci --prefix demo
npm exec --prefix demo -- playwright install chromium
npm run demo:check
```

Start a production build in another terminal:

```bash
npm run build
npm run start -- --hostname 127.0.0.1 --port 3108
```

Record and export:

```bash
npm run demo:record
npm run demo:render
```

The recorder expects a usable real feed and an Agents source. A database-free preview depends on upstream APIs; configure your own local archive for a repeatable source set. To record the public deployment instead, set `DEMO_URL=https://symtri.com npm run demo:record`. Recording submits one public Ask request per viewport, subject to that deployment's quota and model budget. Do not use credentials or private content in footage intended for the public README.

The script records 1600 × 900 and 1080 × 1080 walkthroughs. It waits for feed readiness, explores AI → Agents, opens a real source, and asks about AI and energy. It fails on missing controls, browser errors, or an incomplete answer. Intentional reading pauses are part of the video; network timing and live evidence can vary. Captions use recorded step timestamps rather than assuming fixed load durations.

Playwright saves real WebM files. `prepare.mjs` copies them and their timing manifest into `demo/public/`, which is separate from the application's `public/`. Remotion adds title and end cards, then exports genuine MP4 files. FFmpeg creates the README GIF and rejects exports larger than 8 MiB.

Only publish reviewed final exports:

- `docs/demo.mp4`
- `docs/demo-square.mp4`
- `docs/demo.gif`

Raw recordings, the palette, and render inputs are ignored. App CI checks the optional package independently with its own lockfile; rendering and live recording remain explicit local commands.

Tool references: [Playwright video lifecycle](https://playwright.dev/docs/videos), [Remotion frame timing](https://www.remotion.dev/docs/use-current-frame), and [Remotion CLI rendering](https://www.remotion.dev/docs/cli/render). Tool dependencies retain their own licenses.

## Launch film

`npm run demo:launch` exports the 75-second launch film in wide, square, and vertical formats plus `docs/launch-poster.png`. It uses the reviewed final walkthroughs already in `docs/`, so raw browser recordings are not required. All copied inputs stay in ignored `demo/public/`. The film uses timed, non-overlapping captions and preserves the full scene in portrait framing.

The bundled music has its own attribution license. See [CREDITS.md](CREDITS.md); the rendered end card also retains the credit and notes the audio changes. Keep that attribution when sharing the exported film.
