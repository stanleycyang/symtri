import {parse} from "parse5";
import {writeFile} from "node:fs/promises";
import {request as httpRequest} from "node:http";
import {request as httpsRequest} from "node:https";

const base = new URL(process.env.SYMTRI_CHECK_URL ?? "http://127.0.0.1:3107");
const audit = process.argv.includes("--audit");
const output = process.argv[process.argv.indexOf("--report") + 1];
const issues = [];
const pages = [];
const checked = new Map();
function check(condition, message) { if (!condition) issues.push(message); }
function nodes(root) { return [root, ...(root.childNodes ?? []).flatMap(nodes)]; }
function attr(node, name) { return node.attrs?.find(value => value.name === name)?.value; }
function text(node) {
  if (["script", "style", "template"].includes(node.tagName)) return "";
  return node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join(" ");
}
async function read(path, userAgent = "Googlebot") {
  const started = performance.now();
  const response = await fetch(new URL(path, base), {headers: {"User-Agent": userAgent}, signal: AbortSignal.timeout(30_000)});
  return {status: response.status, html: await response.text(), ms: Math.round(performance.now() - started), headers: Object.fromEntries(["x-robots-tag", "content-type"].map(key => [key, response.headers.get(key)]))};
}
const sitemap = await read("/sitemap.xml");
check(sitemap.status === 200, "Sitemap must return 200");
const sitemapPaths = [...sitemap.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => new URL(match[1]).pathname);
check(sitemapPaths.includes("/") && sitemapPaths.includes("/about") && sitemapPaths.includes("/signal"), "Sitemap must include core pages");
check(new Set(sitemapPaths).size === sitemapPaths.length, "Sitemap URLs must be unique");
const queue = [...new Set(["/", "/about", "/signal", ...sitemapPaths])];
const fragments = [];
for (let i = 0; i < queue.length; i++) {
  const path = queue[i];
  if (checked.has(path)) continue;
  if (queue.length > 400) throw new Error("SEO crawl exceeded its 400-page safety bound");
  const response = await read(path);
  check(response.status === 200, `${path}: status ${response.status}`);
  const all = nodes(parse(response.html));
  const meta = name => attr(all.find(node => node.tagName === "meta" && attr(node, "name") === name) ?? {}, "content");
  const canonical = attr(all.find(node => node.tagName === "link" && attr(node, "rel") === "canonical") ?? {}, "href");
  const title = text(all.find(node => node.tagName === "title") ?? {});
  const h1 = all.filter(node => node.tagName === "h1").map(text);
  const schemas = all.filter(node => node.tagName === "script" && attr(node, "type") === "application/ld+json").flatMap(node => {
    try { const value = JSON.parse((node.childNodes ?? []).map(child => child.value ?? "").join("")); return Array.isArray(value) ? value : [value]; }
    catch { issues.push(`${path}: invalid JSON-LD`); return []; }
  });
  const links = all.filter(node => node.tagName === "a").map(node => attr(node, "href")).filter(Boolean);
  const ids = new Set(all.map(node => attr(node, "id")).filter(Boolean));
  const bodyText = text(all.find(node => node.tagName === "body") ?? {});
  const empty = bodyText.includes("No readable sources are available");
  const noindex = /noindex/.test(`${meta("robots") ?? ""} ${response.headers["x-robots-tag"] ?? ""}`);
  check(h1.length === 1, `${path}: expected one H1, received ${h1.length}`);
  check(Boolean(title && meta("description")), `${path}: missing title or description`);
  check(canonical && new URL(canonical).href === new URL(path, "https://symtri.com").href, `${path}: incorrect canonical ${canonical}`);
  check(schemas.some(schema => schema["@type"] === "WebSite"), `${path}: missing WebSite schema`);
  if (sitemapPaths.includes(path)) check(!noindex, `${path}: noindex URL in sitemap`);
  if (empty) check(noindex && !sitemapPaths.includes(path), `${path}: empty evidence must be noindex and excluded from sitemap`);
  if (path.includes("/sources/")) check(noindex, `${path}: pagination must be noindex`);
  const collection = schemas.find(schema => schema["@type"] === "CollectionPage");
  if (collection) {
    check(collection.name === h1[0]?.replace(/^Earlier sources: /, ""), `${path}: collection name must match subject`);
    for (const entry of collection.mainEntity?.itemListElement ?? []) {
      check(links.includes(entry.item.url), `${path}: schema source is not a visible link`);
      for (const key of ["datePublished", "dateCreated", "dateModified"]) if (entry.item[key]) check(Number.isFinite(Date.parse(entry.item[key])), `${path}: invalid source ${key}`);
    }
    if ((collection.mainEntity?.itemListElement?.length ?? 0) < 3 && !bodyText.includes("temporarily unavailable")) check(noindex && !sitemapPaths.includes(path), `${path}: sparse evidence must remain outside the indexable sitemap`);
    if (collection.mainEntity?.itemListElement?.length) {
      check(bodyText.includes("First archived"), `${path}: expose source discovery dates separately from publication`);
      for (const time of all.filter(node => node.tagName === "time")) check(Number.isFinite(Date.parse(attr(time, "datetime"))), `${path}: invalid visible timestamp`);
    }
  }
  for (const href of links) {
    let url;
    try { url = new URL(href, new URL(path, base)); } catch { issues.push(`${path}: malformed link`); continue; }
    if (![base.origin, "https://symtri.com"].includes(url.origin) || url.pathname.startsWith("/api/") || /\.(xml|png|svg|txt)$/.test(url.pathname)) continue;
    // Verify one older page per subject; do not crawl an unbounded archive.
    if (path.includes("/sources/") && url.pathname.includes("/sources/")) continue;
    if (url.hash) fragments.push({from: path, path: url.pathname, id: decodeURIComponent(url.hash.slice(1))});
    // Query URLs are map state or attribution; stable editorial URLs carry the crawl.
    if (!url.search && !queue.includes(url.pathname)) queue.push(url.pathname);
  }
  const page = {path, status: response.status, ms: response.ms, title, description: meta("description"), canonical, noindex, emptyEvidence: empty, schemaTypes: schemas.map(schema => schema["@type"]), internalLinks: links.filter(href => href.startsWith("/")), words: bodyText.trim().split(/\s+/).length};
  pages.push(page);
  checked.set(path, {ids, page});
}
for (const fragment of fragments) check(checked.get(fragment.path)?.ids.has(fragment.id), `${fragment.from}: missing anchor ${fragment.path}#${fragment.id}`);
for (const name of ["title", "description"]) {
  const unique = new Set();
  for (const page of pages.filter(page => !page.noindex)) {
    check(!unique.has(page[name]), `${page.path}: duplicate ${name}`);
    unique.add(page[name]);
  }
}
for (const path of ["/not-a-region", "/ai/not-a-thread", "/ai/agents/sources/bad", "/signal/9999-99"]) check((await read(path)).status === 404, `${path}: invalid route must return 404`);
const robots = await read("/robots.txt");
check(robots.status === 200 && /Allow: \/\s/.test(robots.html) && /Disallow: \/api\//.test(robots.html) && /Sitemap: https:\/\/symtri.com\/sitemap.xml/.test(robots.html), "Robots must allow public content and reference sitemap");
const hostVariant = base.hostname === "symtri.com" ? new URL("https://www.symtri.com/ai/agents?point=ai-agents&item=123") : new URL("/ai/agents?point=ai-agents&item=123", base);
// Fetch's Host override is ignored by some Node versions. Use the HTTP client
// to exercise the incoming host rule on the isolated production server.
const hostRedirect = await new Promise((resolve, reject) => {
  const request = (hostVariant.protocol === "https:" ? httpsRequest : httpRequest)(hostVariant, {headers: {Host: "www.symtri.com"}}, response => {
    response.resume();
    resolve({status: response.statusCode, location: response.headers.location});
  });
  request.setTimeout(20_000, () => request.destroy(new Error("Host redirect timed out")));
  request.on("error", reject);
  request.end();
});
check(hostRedirect.status === 308 && hostRedirect.location === "https://symtri.com/ai/agents?point=ai-agents&item=123", "WWW public redirect must retain the path and content-identifying query values");
for (const crawler of ["OAI-SearchBot", "Bingbot", "PerplexityBot"]) {
  const response = await read("/", crawler);
  check(response.status === 200 && !/noindex/.test(response.headers["x-robots-tag"] ?? ""), `${crawler}: homepage blocked by hosting or header`);
}
const report = {verifierVersion: 2, observedAt: new Date().toISOString(), base: base.href, sitemapPages: sitemapPaths.length, crawledPages: pages.length, issues, pages};
if (process.argv.includes("--report") && output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({base: base.href, sitemapPages: sitemapPaths.length, crawledPages: pages.length, issues}, null, 2));
if (issues.length && !audit) process.exitCode = 1;
