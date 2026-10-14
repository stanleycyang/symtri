// Record an interactive demo of the live site using Playwright.
// Usage: npm run demo:record
// Optional: DEMO_URL=https://symtri.com npm run demo:record
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const target = process.env.DEMO_URL || "https://symtri.com";
const outDir = path.resolve("demo/out");
await fs.mkdir(outDir, { recursive: true });

async function record(width, height, name) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: outDir, size: { width, height } },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  await page.goto(target, { waitUntil: "domcontentloaded" });

  // Wait for the live feed to be ready or connecting (friendly state).
  // The topbar only appears after entering; ensure the initial page is loaded.
  await page.waitForSelector("button.enter-button", { state: "visible" });

  // Smooth interactions — avoid cursor jank between shots.
  await page.waitForTimeout(500);

  // Enter the universe.
  await page.click("button.enter-button");

  // Give the scene time to settle.
  await page.waitForTimeout(1200);

  // Navigate to the AI region using the peek strip dots (accessible buttons).
  // Fallback to direct link if the strip is not visible at this viewport.
  const aiButton = page.locator('.region-dots button[aria-label="Explore AI"]');
  if (await aiButton.count()) {
    await aiButton.first().click();
  } else {
    await page.goto(`${target}?point=ai`);
  }

  // Focus the Agents topic from the list if present.
  const agents = page.locator('.topic-list button:has-text("Agents")');
  await agents.first().click().catch(() => {});

  // Open Ask and submit a cross-topic question.
  await page.click("button.ask-trigger");
  await page.fill('input#symtri-question', "How is AI connected to energy?");
  await page.click('form button[type="submit"]');

  // Give the answer a short window to synthesize and render so it’s readable.
  await page.waitForSelector(".ask-result, .ask-state--error", { timeout: 40_000 }).catch(() => {});
  await page.waitForTimeout(3500);

  const v = await page.video();
  await page.close();
  await context.close();
  await browser.close();
  const raw = await v.path();
  const finalPath = path.join(outDir, `${name}.mp4`);
  await fs.rename(raw, finalPath);
  return finalPath;
}

const square = await record(1080, 1080, "raw-1080x1080");
const wide = await record(1600, 1000, "raw-1600x1000");
console.log(JSON.stringify({ square, wide }, null, 2));

