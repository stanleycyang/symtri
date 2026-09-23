import assert from "node:assert/strict";
import test from "node:test";
import { classifySignal } from "./classify";
import { selectFeedEvents } from "./feed";
import { deduplicateSignals, normalizeArxivFeed, normalizeGitHub, normalizeHackerNews } from "./normalize";

test("classification prefers a specific thread and leaves unrelated stories unmapped", () => {
  assert.deepEqual(classifySignal("AI coding agents use tools", "A benchmark of tool use")[0]?.subtopicId, "ai-coding-agents");
  assert.equal(classifySignal("New nuclear reactor design", "Small modular reactors")[0]?.subtopicId, "energy-nuclear");
  assert.deepEqual(classifySignal("Local garden calendar", "Seed planting tips"), []);
  assert.deepEqual(classifySignal("Umbrella insurance via your personal agent", "Hacker News discussion"), []);
  assert.equal(classifySignal("Sparse attention for language models", "We also mention agent use", ["cs.AI"])[0]?.subtopicId, "ai-language-models");
  assert.equal(classifySignal("Sparse attention architecture", "Agents use this model", ["cs.AI"])[0]?.subtopicId, null);
});

test("solar wind research does not create a false energy connection", () => {
  const wind = classifySignal("Solar wind speed forecasting with AI", "Forecasts from solar images", ["cs.AI"]);
  assert.ok(wind.some((match) => match.topicId === "ai"));
  assert.ok(!wind.some((match) => match.topicId === "energy"));
  const power = classifySignal("Solar power forecasting with AI", "Photovoltaic energy research", ["cs.AI"]);
  assert.ok(power.some((match) => match.topicId === "energy" && match.subtopicId === "energy-solar"));
  assert.ok(classifySignal("Solar panels built over irrigation canals", "Hacker News discussion").some((match) => match.topicId === "energy" && match.subtopicId === "energy-solar"));
});

test("specific story titles map to regions without inferring unrelated ones", () => {
  assert.equal(classifySignal("Obscura: VPN that cannot log your activity", "Hacker News discussion")[0]?.topicId, "security");
  assert.equal(classifySignal("GPT-6 Sol performance analysis", "Hacker News discussion")[0]?.topicId, "ai");
  assert.equal(classifySignal("Launch HN: Coverage Cat (YC S22)", "Umbrella insurance")[0]?.topicId, "startups");
  assert.deepEqual(classifySignal("Umbrella insurance via your personal agent", "Hacker News discussion"), []);
});

test("Hacker News normalization rejects dead stories and unsafe URLs", () => {
  const event = normalizeHackerNews({ id: 123, type: "story", title: "AI agents &amp; tools", time: 1780000000, score: 25, descendants: 6, url: "javascript:alert(1)" });
  assert.equal(event?.url, "https://news.ycombinator.com/item?id=123");
  assert.equal(event?.title, "AI agents & tools");
  assert.equal(event?.topics[0]?.topicId, "ai");
  assert.equal(normalizeHackerNews({ id: 123, type: "story", deleted: true, title: "AI", time: 1780000000 }), null);
});

test("GitHub and arXiv normalize to the same event shape", () => {
  const github = normalizeGitHub({ id: 42, full_name: "example/agent-kit", created_at: "2026-09-22T12:00:00Z", html_url: "https://github.com/example/agent-kit", description: "AI coding agent tools", stargazers_count: 80, topics: ["ai-agents"], fork: false });
  assert.equal(github?.id, "github:42");
  assert.equal(github?.topics[0]?.topicId, "ai");
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2609.12345v2</id><title>Agentic Tool Use for Language Models</title><summary>Research on AI agents.</summary><published>2026-09-22T12:00:00Z</published><category term="cs.AI" /></entry></feed>`;
  const [paper] = normalizeArxivFeed(xml);
  assert.equal(paper.id, "arxiv:2609.12345");
  assert.equal(paper.url, "https://arxiv.org/abs/2609.12345");
  assert.equal(paper.topics[0]?.topicId, "ai");
});

test("deduplication keeps the stronger observation for the same URL", () => {
  const first = normalizeHackerNews({ id: 44, type: "story", title: "AI agent toolkit", time: 1780000000, score: 100, descendants: 20, url: "https://example.com/agent?ref=hn" })!;
  const second = { ...first, id: "github:55", source: "github" as const, externalId: "55", importance: 5, url: "https://example.com/agent" };
  const input = [second, first];
  assert.deepEqual(deduplicateSignals(input).map((event) => event.id), [first.id]);
  assert.deepEqual(input.map((event) => event.id), [second.id, first.id]);
});

test("feed selection keeps mapped signals before applying the cap or deduplicating", () => {
  const mapped = normalizeHackerNews({ id: 71, type: "story", title: "AI agent toolkit", time: Date.parse("2026-09-22T12:00:00Z") / 1000, score: 2, url: "https://example.com/agent" })!;
  const unmapped = { ...mapped, id: "hacker-news:72", externalId: "72", title: "Garden calendar", topics: [], importance: 99, publishedAt: "2026-09-23T12:00:00Z" };
  const second = normalizeGitHub({ id: 73, full_name: "example/database", created_at: "2026-09-21T12:00:00Z", html_url: "https://github.com/example/database", description: "Open source database", stargazers_count: 20, fork: false })!;
  const input = [unmapped, mapped, second];
  assert.deepEqual(selectFeedEvents(input, 2).map((event) => event.id), [mapped.id, second.id]);
  assert.equal(input.length, 3);
});
