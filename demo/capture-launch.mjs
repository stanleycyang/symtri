import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const destination = path.resolve(directory, "../docs/launch-assets");
const temporaryRoot = path.join(directory, "out");
await fs.mkdir(temporaryRoot, { recursive: true });
const output = await fs.mkdtemp(path.join(temporaryRoot, "launch-capture-"));
const target = new URL(process.env.DEMO_URL || "https://symtri.com");
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", deviceScaleFactor: 3 });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(target.href);
  await page.locator(".enter-button").click();
  await page.waitForFunction(() => /(?:LIVE|ARCHIVED) (?:STORIES|FEED)/.test(document.querySelector(".topbar-center")?.textContent ?? ""));
  await page.locator("#universe canvas").waitFor();
  await page.screenshot({ path: path.join(output, "map.png") });
  console.log("Captured the live overview.");
  await page.locator("#map-point-search").fill("Artificial Intelligence");
  await page.locator("#map-point-search").press("Enter");
  await page.locator(".topic-list").getByRole("button", { name: /^Agents\b/ }).waitFor();
  await page.screenshot({ path: path.join(output, "threads.png") });
  await page.locator(".ask-trigger").click();
  await page.locator("#symtri-question").fill("How is AI connected to energy?");
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (String(args[0]).includes("/api/ask")) {
        response.clone().text().then(body => { window.__launchAnswer = body; });
      }
      return response;
    };
  });
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/ask" && response.request().method() === "POST");
  await page.locator('.ask-panel button[type="submit"]').click();
  const response = await pending;
  if (!response.ok()) throw new Error(`Ask returned ${response.status()}`);
  await page.waitForFunction(() => typeof window.__launchAnswer === "string", undefined, { timeout: 120_000 });
  const body = await page.evaluate(() => window.__launchAnswer);
  const messages = body.trim().split("\n").map(line => JSON.parse(line));
  const answer = messages.find(message => message.type === "complete")?.answer ?? messages.find(message => message.question);
  if (!answer?.claims?.length || !answer.events?.length) throw new Error("No completed source-backed answer available for the film.");
  await page.locator(".ask-claims").waitFor();
  await page.locator(".ask-panel").screenshot({ path: path.join(output, "ask.png") });
  console.log("Captured a real source-backed Ask answer.");
  const source = answer.events.find(event => answer.citedEventIds.includes(event.id)) ?? answer.events[0];
  const link = new URL(target.href);
  link.searchParams.set("point", "ai"); link.searchParams.set("signal", source.id);
  await page.goto(link.href);
  await page.locator(".story-reading h3").waitFor();
  await page.locator(".read-source").waitFor();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.locator(".detail-panel").screenshot({ path: path.join(output, "source.png") });
  console.log("Captured the cited source detail.");
  await page.goto(new URL("/signal", target).href);
  await page.locator(".report-summary li").first().waitFor();
  await page.locator(".report-header").screenshot({ path: path.join(output, "signal-header.png") });
  await page.locator(".report-summary").screenshot({ path: path.join(output, "signal.png") });
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await fs.writeFile(path.join(output, "provenance.json"), JSON.stringify({ capturedAt: new Date().toISOString(), origin: target.origin, question: answer.question, source: { id: source.id, title: source.title, url: source.url }, summaryKind: answer.summaryKind, note: "Unmodified public product screenshots; reduced motion used for stable captures. One real Ask request, no intercepted or fabricated API responses." }, null, 2) + "\n");
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(output, destination, { recursive: true });
  console.log("Captured the current weekly Signal and saved provenance.");
} finally {
  await browser.close();
  await fs.rm(output, { recursive: true, force: true });
}
