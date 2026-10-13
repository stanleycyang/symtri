/** Local-only evidence for production-browser and crawler regression checks. */
import postgres from "postgres";
import {persistSignals, persistCurrentFeed, getArchiveActivity, getArchiveChildCounts, getArchiveRelationships} from "../lib/data/storage";
import {seedUniverseCatalog} from "../lib/data/catalog";
import {ENRICHMENT_VERSION} from "../lib/data/reading-note-version";
import type {SignalEvent, SignalFeed} from "../lib/data/model";
import {buildWeeklyDigest} from "../lib/data/digest";
import {saveWeeklyReport} from "../lib/data/reports";

async function main() {
const url = process.env.SYMTRI_TEST_DATABASE_URL;
if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("SEO fixtures require an isolated loopback database");
process.env.DATABASE_URL = url;
const sql = postgres(url, {max: 1, prepare: false});
await seedUniverseCatalog();
await sql`update source_catalog set status='active' where id in ('github', 'arxiv', 'hacker-news')`;
const now = new Date();
const events: SignalEvent[] = Array.from({length: 25}, (_, i) => ({
  id: `github:seo-fixture-${i}`, source: "github", externalId: `seo-fixture-${i}`,
  title: `Local QA fixture ${i + 1}: AI agent evaluation`, url: `https://example.org/symtri-qa/${i}`,
  summary: "Controlled local test evidence for archive pagination. This is a test fixture, not a published research finding.",
  publishedAt: new Date(now.getTime() - (i + 1) * 3_600_000).toISOString(), importance: 20,
  topics: [{topicId: "ai", subtopicId: "ai-agents", relevance: 1}, {topicId: "software", subtopicId: "software-developer-tools", relevance: 1}],
}));
await persistSignals({observedAt: now.toISOString(), events, sources: {github: "ok"}, partial: false, scope: "archive"});
for (const event of events) {
  const note = {explanation: event.summary, claims: [], context: [], questions: [], evidenceSource: "github", evidenceUrl: event.url, evidenceAttribution: "Local QA fixture", sourceKind: "repository", createdAt: now.toISOString()};
  await sql`update reading_notes set status='ready', version=${ENRICHMENT_VERSION}, note=${sql.json(note)}, published_revision=revision, published_at=now() where signal_id=${event.id}`;
}
const activity = await getArchiveActivity(now);
const childCounts = await getArchiveChildCounts(now);
const relationships = await getArchiveRelationships(now);
const feed: SignalFeed = {observedAt: now.toISOString(), sources: {github: "ok", arxiv: "unavailable", "hacker-news": "unavailable"}, partial: true, scope: "archive", events, activity, childCounts, relationships};
await persistCurrentFeed(feed);
const weekStart = new Date("2026-10-05T12:00:00Z");
const historical = {...feed, observedAt: weekStart.toISOString(), events: events.slice(0, 3).map((event, i) => ({...event, publishedAt: new Date(weekStart.getTime() - i * 60_000).toISOString()}))};
await saveWeeklyReport(buildWeeklyDigest(new Date("2026-10-12T00:00:00Z"), [historical]));
await sql.end();
console.log("Seeded 25 clearly labeled local QA sources, measured region connections, and one weekly fixture report.");
process.exit(0);

}
main().catch(error => {console.error(error); process.exitCode = 1;});
