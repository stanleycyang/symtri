import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const target = new URL(process.env.DEMO_URL || "http://127.0.0.1:3108");
const outDir = path.join(directory, "out");
await fs.mkdir(outDir, { recursive: true });

async function record(width, height, id) {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width, height }, recordVideo: { dir: outDir, size: { width, height } }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(45_000);
    const captions = [];
    const started = Date.now();
    const caption = text => { captions.push({ seconds: (Date.now() - started) / 1000, text }); console.log(`[${id}] ${text}`); };
    await page.goto(target.href, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "ENTER THE UNIVERSE" }).click();
    caption("Enter the universe");
    await page.waitForFunction(() => /\b(?:LIVE|ARCHIVED) (?:STORIES|FEED)\b/.test(document.querySelector(".topbar-center")?.textContent ?? ""));
    const canvas = page.locator("#universe canvas");
    await canvas.waitFor();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("No visible WebGL canvas");
    caption("Drag to orbit. Scroll to zoom.");
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.65);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.6, { steps: 24 });
    await page.mouse.up();
    await page.mouse.wheel(0, -180);
    await page.locator("#map-point-search").fill("Artificial Intelligence");
    await page.locator("#map-point-search").press("Enter");
    await page.locator(".topic-list").getByRole("button", { name: /^Agents\b/ }).click();
    caption("Explore AI → Agents");
    await page.locator("button[data-source-id]").first().click();
    await page.locator(".read-source").waitFor();
    caption("Follow a signal to its original source");
    // Intentional reading time is part of the exported walkthrough, not a readiness wait.
    await page.waitForTimeout(1500);
    await page.locator("button.ask-trigger").click();
    await page.locator("#symtri-question").fill("How is AI connected to energy?");
    caption("Ask how AI connects to energy");
    await page.locator('.ask-panel button[type="submit"]').click();
    await page.waitForFunction(() => {
      const result = document.querySelector(".ask-result");
      return result && !document.querySelector(".ask-preview-label") && !document.querySelector(".ask-state--error");
    }, null, { timeout: 50_000 });
    caption("Read the answer and its evidence limits");
    await page.waitForTimeout(2500);
    if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
    const video = page.video();
    if (!video) throw new Error("Recording did not start");
    await context.close();
    const file = `${id}.webm`;
    await video.saveAs(path.join(outDir, file));
    await video.delete();
    const { stdout } = await execute("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", path.join(outDir, file)]);
    const duration = Number(JSON.parse(stdout).format.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid recording duration");
    return { id, width, height, file, duration, captions };
  } finally { await context.close(); await browser.close(); }
}

const clips = [await record(1600, 900, "DemoWide"), await record(1080, 1080, "DemoSquare")];
await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify({ clips }, null, 2) + "\n");
console.log("Recorded both walkthroughs. Run npm run demo:render from the repo root.");
