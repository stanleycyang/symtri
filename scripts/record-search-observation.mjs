import assert from "node:assert/strict";
import {readFile, appendFile} from "node:fs/promises";

const input = process.argv[process.argv.indexOf("--input") + 1];
const output = process.argv[process.argv.indexOf("--output") + 1];
assert.ok(process.argv.includes("--input") && input && process.argv.includes("--output") && output, "Usage: node scripts/record-search-observation.mjs --input observation.json --output observations.jsonl");
const benchmark = JSON.parse(await readFile(new URL("../docs/seo/query-benchmark.json", import.meta.url), "utf8"));
const record = JSON.parse(await readFile(input, "utf8"));
assert.ok(benchmark.queries.some(query => query.id === record.queryId), "Use a benchmark query ID");
assert.ok(["google", "bing", "chatgpt", "perplexity", "gemini", "claude", "copilot", "web-search"].includes(record.provider), "Unknown provider");
assert.ok(Number.isFinite(Date.parse(record.observedAt)) && Date.parse(record.observedAt) <= Date.now() + 60_000, "Use a real observation timestamp");
assert.ok(typeof record.locale === "string" && record.locale.length > 0, "Record locale");
assert.ok(typeof record.evidence === "string" && record.evidence.length > 0, "Attach the result URL, screenshot, or saved response artifact");
for (const outcome of ["retrieved", "cited", "mentioned", "recommended"]) assert.ok(record[outcome] === null || typeof record[outcome] === "boolean", `${outcome} must be true, false, or null (unmeasured)`);
assert.ok(record.rank === null || Number.isInteger(record.rank) && record.rank > 0, "Rank is a positive observed position or null");
assert.ok(Array.isArray(record.citedUrls) && Array.isArray(record.competitorUrls), "Record citedUrls and competitorUrls arrays");
for (const url of [...record.citedUrls, ...record.competitorUrls]) assert.ok(["http:", "https:"].includes(new URL(url).protocol), "Evidence URLs must be HTTP(S)");
if (record.cited === true) {
  assert.ok(record.citedUrls.some(url => ["symtri.com", "www.symtri.com"].includes(new URL(url).hostname)), "A citation requires an actual SYMTRI source URL");
  assert.notEqual(record.retrieved, false, "Cited content cannot be marked not retrieved");
} else assert.equal(record.citedUrls.length, 0, "Do not record citations when citation outcome is false or unmeasured");
const fields = ["queryId", "provider", "observedAt", "locale", "model", "signedIn", "searchEnabled", "rank", "retrieved", "cited", "mentioned", "recommended", "citedUrls", "competitorUrls", "evidence", "notes"];
const sanitized = Object.fromEntries(fields.filter(key => key in record).map(key => [key, record[key]]));
await appendFile(output, JSON.stringify(sanitized) + "\n");
const records = (await readFile(output, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const summary = Object.fromEntries(["retrieved", "cited", "mentioned", "recommended"].map(outcome => {
  const measured = records.filter(row => typeof row[outcome] === "boolean");
  return [outcome, {observations: measured.length, positive: measured.filter(row => row[outcome]).length, rate: measured.length ? measured.filter(row => row[outcome]).length / measured.length : null}];
}));
console.log(JSON.stringify({records: records.length, summary, note: "Raw observation rates; repeated samples are not independent and do not establish causation."}, null, 2));
