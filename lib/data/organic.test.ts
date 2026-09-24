import assert from "node:assert/strict";
import test from "node:test";
import { candidatePhrases, catalogMatches, placement } from "./catalog";
import { normalizeSyndicationFeed } from "./normalize";
import { feedLinkFromHtml, publicHttpsUrl } from "./public-fetch";
import { seedCatalog } from "../universe";

test("candidate phrases keep durable subjects and ignore generic words", () => {
  assert.ok(candidatePhrases("New quantum sensors for orbital monitoring").includes("quantum sensors"));
  assert.ok(!candidatePhrases("New quantum sensors").includes("new quantum"));
});

test("new catalog points classify fresh signals without losing existing matches", () => {
  const point = { id: "organic-test", name: "Quantum Sensors", short: "QUANTUM SENSORS", description: "", position: [25, 4, 4] as [number, number, number], color: "#fff", activity: 30, change: 0, signals: 0, children: [] };
  const event = { id: "test:1", source: "github", externalId: "1", title: "Quantum sensors for orbit tracking", summary: "Semiconductor research", url: "https://example.com/1", publishedAt: new Date().toISOString(), importance: 40,
    topics: [{ topicId: "hardware", subtopicId: null, relevance: .8 }] };
  const matches = catalogMatches(event, { ...seedCatalog, topics: [...seedCatalog.topics, point] });
  assert.ok(matches.some((match) => match.topicId === "organic-test"));
  assert.ok(matches.some((match) => match.topicId === "hardware"));
  const position = placement(point.id, null, seedCatalog.topics.map((topic) => topic.position));
  assert.ok(seedCatalog.topics.every((topic) => Math.hypot(...position.map((value, index) => value - topic.position[index]) as [number, number, number]) >= 8));
});

test("RSS normalization keeps source identity and rejects thin items", () => {
  const xml = `<rss><channel><item><guid>one</guid><title>Quantum sensors advance</title><link>https://example.com/one</link><description>Researchers built a new quantum sensing instrument for orbital monitoring.</description><pubDate>Wed, 23 Sep 2026 12:00:00 GMT</pubDate></item><item><guid>two</guid><title>Short</title><link>https://example.com/two</link><description>Brief.</description><pubDate>Wed, 23 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  const events = normalizeSyndicationFeed(xml, "feed-123");
  assert.equal(events.length, 1);
  assert.equal(events[0].source, "feed-123");
  assert.match(events[0].id, /^feed-123:/);
});

test("Atom alternate links become source events", () => {
  const xml = `<feed><entry><id>tag:example,2026:1</id><title>Quantum sensors advance</title><link rel="self" href="https://example.com/api/1"/><link rel="alternate" href="https://example.com/one"/><summary>Researchers built a new quantum sensing instrument for orbital monitoring.</summary><published>2026-09-23T12:00:00Z</published></entry></feed>`;
  assert.equal(normalizeSyndicationFeed(xml, "feed-123")[0]?.url, "https://example.com/one");
});

test("feed discovery reads alternate links and blocks local destinations", async () => {
  assert.equal(feedLinkFromHtml('<link rel="alternate" type="application/rss+xml" href="/rss.xml">', "https://example.com/article"), "https://example.com/rss.xml");
  await assert.rejects(publicHttpsUrl("https://127.0.0.1/feed"), /not public/);
  await assert.rejects(publicHttpsUrl("http://example.com/feed"), /HTTPS/);
});
