import assert from "node:assert/strict";
import test from "node:test";
import { classifySignal } from "./classify";
import { selectFeedEvents } from "./feed";
import { selectDistinctHeadlines, selectFocusedSignals, selectRegionHighlights } from "./select";
import { canonicalSignalUrl, deduplicateSignals, normalizeArxivFeed, normalizeGitHub, normalizeHackerNews, uniqueSourceObservations } from "./normalize";

test("classification prefers a specific thread and leaves unrelated stories unmapped", () => {
  assert.deepEqual(classifySignal("AI coding agents use tools", "A benchmark of tool use")[0]?.subtopicId, "ai-coding-agents");
  assert.equal(classifySignal("New nuclear reactor design", "Small modular reactors")[0]?.subtopicId, "energy-nuclear");
  assert.deepEqual(classifySignal("Local garden calendar", "Seed planting tips"), []);
  assert.deepEqual(classifySignal("Umbrella insurance via your personal agent", "Hacker News discussion"), []);
  assert.equal(classifySignal("Sparse attention for language models", "We also mention agent use", ["cs.AI"])[0]?.subtopicId, "ai-language-models");
  assert.equal(classifySignal("Sparse attention architecture", "Agents use this model", ["cs.AI"])[0]?.subtopicId, null);
  assert.equal(classifySignal("Feds Target AI Critics as Foreign Agents", "Hacker News discussion")[0]?.subtopicId, null);
  assert.equal(classifySignal("AI agents operating as foreign agents", "Hacker News discussion")[0]?.subtopicId, "ai-agents");
});

test("solar wind research does not create a false energy connection", () => {
  const wind = classifySignal("Solar wind speed forecasting with AI", "Forecasts from solar images", ["cs.AI"]);
  assert.ok(wind.some((match) => match.topicId === "ai"));
  assert.ok(!wind.some((match) => match.topicId === "energy"));
  const power = classifySignal("Solar power forecasting with AI", "Photovoltaic energy research", ["cs.AI"]);
  assert.ok(power.some((match) => match.topicId === "energy" && match.subtopicId === "energy-solar"));
  assert.ok(classifySignal("Solar panels built over irrigation canals", "Hacker News discussion").some((match) => match.topicId === "energy" && match.subtopicId === "energy-solar"));
});

test("cosmology dark energy stays in space without an applied energy link", () => {
  const cosmology = classifySignal(
    "Entropy applications in cosmology: spacetime thermodynamics, holographic dark energy and entropic gravity",
    "A review of quantum gravity and cosmology", ["astro-ph.CO", "gr-qc"]);
  assert.ok(cosmology.some((match) => match.topicId === "space"));
  assert.ok(!cosmology.some((match) => match.topicId === "energy"));
  assert.ok(classifySignal("New solar power satellites", "Photovoltaic energy generation", ["astro-ph.IM"])
    .some((match) => match.topicId === "energy"));
});

test("computational space is not astronomy and astro-ph outweighs incidental GPU wording", () => {
  const quantum = classifySignal("Constant-space-overhead fault-tolerant quantum computation", "Uses constant-space overhead", ["quant-ph"]);
  assert.equal(quantum[0]?.topicId, "science");
  assert.ok(!quantum.some((match) => match.topicId === "space"));
  assert.ok(!classifySignal("Learning in latent space", "A vector space model", ["cs.AI"])
    .some((match) => match.topicId === "space"));
  const astrophysics = classifySignal("Differentiable astrophysics on the GPU", "Astronomers use graphics processing units", ["astro-ph.IM", "physics.comp-ph"]);
  assert.equal(astrophysics[0]?.topicId, "space");
  assert.equal(astrophysics[0]?.subtopicId, "space-astronomy");
  assert.equal(classifySignal("Astronomical multiband time series", "", ["astro-ph.IM"])[0]?.subtopicId, "space-astronomy");
  assert.equal(classifySignal("Sterile Neutrino Dark Matter", "", ["astro-ph.CO"])[0]?.subtopicId, "space-astronomy");
  assert.ok(classifySignal("New space telescope photographs a galaxy", "", []).some((match) => match.topicId === "space"));
});

test("disk space and device activity do not create false map regions", () => {
  assert.ok(!classifySignal("cleanupper disk-space", "Open-source macOS disk cleanup CLI")
    .some((match) => match.topicId === "space"));
  assert.deepEqual(classifySignal("A 3D visualization for user/device activity data", "Hacker News discussion."), []);
  assert.ok(classifySignal("The newest ESP32 can run Linux", "A tiny microcontroller board")
    .some((match) => match.topicId === "hardware"));
});

test("cyberattack and phishing sources connect Security to adjacent topics", () => {
  const attack = classifySignal("AI is making cyberattacks faster", "Hacker News discussion.");
  assert.deepEqual(new Set(attack.map((match) => match.topicId)), new Set(["ai", "security"]));
  assert.ok(attack.some((match) => match.subtopicId === "security-cybersecurity"));
  const phishing = classifySignal("Phishing detection for fintech emails", "A digital lending research paper", ["q-fin.TR"]);
  assert.deepEqual(new Set(phishing.map((match) => match.topicId)), new Set(["markets", "security"]));
  assert.ok(phishing.some((match) => match.subtopicId === "security-cybersecurity"));
});

test("arXiv quantum subjects keep their physics location beside cross-domain topics", () => {
  const battery = classifySignal("Simulation of a Battery Cell on Quantum Computers: Reactions & Transport", "", ["quant-ph"]);
  assert.equal(battery[0]?.topicId, "science");
  assert.equal(battery[0]?.subtopicId, "science-physics");
  assert.ok(battery.some((match) => match.topicId === "energy"));
  const circuits = classifySignal("Distilling Datasets into Shallow Circuits for Quantum Machine Learning", "", ["quant-ph"]);
  assert.equal(circuits[0]?.topicId, "science");
  assert.equal(circuits[0]?.subtopicId, "science-physics");
  assert.ok(!classifySignal("Quantum art exhibit", "", []).some((match) => match.topicId === "science"));
});

test("fusion research maps to the Energy thread without treating generic plasma as fusion", () => {
  assert.equal(classifySignal("Fusion confinement in a tokamak", "Plasma experiments", ["physics.plasm-ph"])[0]?.subtopicId, "energy-fusion");
  assert.equal(classifySignal("Stellarator equilibrium for fusion energy", "Magnetic confinement", ["physics.plasm-ph"])[0]?.subtopicId, "energy-fusion");
  assert.ok(!classifySignal("Plasma transport in stellar atmospheres", "Solar wind", ["physics.plasm-ph"]).some((match) => match.topicId === "energy"));
});

test("atmospheric research reaches Climate Science without labeling every ocean paper as climate", () => {
  const climate = classifySignal("Toward GPU-Resident Climate Models", "A study of atmospheric simulation", ["physics.ao-ph"]);
  assert.equal(climate[0]?.topicId, "science");
  assert.equal(climate[0]?.subtopicId, "science-climate-science");
  const ocean = classifySignal("Blinded evaluation of oceanic sound source locations", "Acoustic localization", ["physics.ao-ph"]);
  assert.ok(ocean.some((match) => match.topicId === "science"));
  assert.ok(!ocean.some((match) => match.subtopicId === "science-climate-science"));
});

test("specific story titles map to regions without inferring unrelated ones", () => {
  assert.equal(classifySignal("Obscura: VPN that cannot log your activity", "Hacker News discussion")[0]?.topicId, "security");
  assert.equal(classifySignal("GPT-6 Sol performance analysis", "Hacker News discussion")[0]?.topicId, "ai");
  assert.equal(classifySignal("Launch HN: Coverage Cat (YC S22)", "Umbrella insurance")[0]?.topicId, "startups");
  assert.deepEqual(classifySignal("Umbrella insurance via your personal agent", "Hacker News discussion"), []);
});

test("clear source headlines reach their regions while ordinary stories stay unmapped", () => {
  const cases: [string, string[]][] = [
    ["Claude discovers a novel enzyme system with CRISPR-like repeats", ["ai", "science"]],
    ["VSCode's SSH Agent Is Bananas", ["software"]],
    ["UK military jamming other nations' satellites", ["space"]],
    ["An analyst infiltrated a supply-chain hacking gang", ["security"]],
    ["Meta VR Glasses", ["hardware"]],
  ];
  for (const [title, regions] of cases) {
    const matches = classifySignal(title, "Hacker News discussion.").map((match) => match.topicId);
    for (const region of regions) assert.ok(matches.includes(region), `${title} should map to ${region}`);
  }
  assert.deepEqual(classifySignal("Fixing the Portobello Police Station Clock", "Hacker News discussion."), []);
  assert.deepEqual(classifySignal("Umbrella insurance via your personal agent", "Hacker News discussion."), []);
  assert.equal(classifySignal("Testing distributed systems", "A study", ["cs.SE"])[0]?.topicId, "software");
  assert.equal(classifySignal("Liquidity in limit order books", "A study", ["q-fin.TR"])[0]?.topicId, "markets");
  assert.equal(classifySignal("Molecular interaction networks", "A study", ["q-bio.MN"])[0]?.topicId, "science");
});

test("Hacker News normalization rejects dead stories and unsafe URLs", () => {
  const event = normalizeHackerNews({ id: 123, type: "story", title: "AI agents &amp; tools", time: 1780000000, score: 25, descendants: 6, url: "javascript:alert(1)" });
  assert.equal(event?.url, "https://news.ycombinator.com/item?id=123");
  assert.equal(event?.title, "AI agents & tools");
  assert.equal(event?.topics[0]?.topicId, "ai");
  assert.equal(normalizeHackerNews({ id: 123, type: "story", deleted: true, title: "AI", time: 1780000000 }), null);
});

test("Hacker News text decodes numeric and named HTML entities", () => {
  const event = normalizeHackerNews({ id: 124, type: "story", title: "AI&#x27;s research &amp; tools", text: "<p>It isn&#x27;t hidden&#x2F;lost &mdash; it&#39;s here.</p>", time: 1780000000 });
  assert.equal(event?.title, "AI's research & tools");
  assert.equal(event?.summary, "It isn't hidden/lost — it's here.");
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
  assert.equal(canonicalSignalUrl("https://EXAMPLE.com/Agent/?ref=hn"), "example.com/agent");
});

test("deduplication preserves distinct query-identified documents", () => {
  const first = normalizeHackerNews({ id: 47, type: "story", title: "First research question", time: 1780000000,
    score: 10, text: "The first question concerns AI agents." })!;
  const second = normalizeHackerNews({ id: 48, type: "story", title: "Second research question", time: 1780000000,
    score: 10, text: "The second question concerns AI models." })!;
  assert.equal(canonicalSignalUrl(first.url), "news.ycombinator.com/item?id=47");
  assert.equal(canonicalSignalUrl(second.url), "news.ycombinator.com/item?id=48");
  assert.deepEqual(deduplicateSignals([first, second]).map((item) => item.id).sort(), [first.id, second.id]);
  assert.equal(canonicalSignalUrl("https://example.com/article?b=2&utm_source=hn&a=1&fbclid=abc"), "example.com/article?a=1&b=2");
});

test("deduplication keeps one copy of identical content across URLs", () => {
  const first = normalizeHackerNews({ id: 47, type: "story", title: "AI agent toolkit", time: 1780000000,
    score: 100, url: "https://original.example/agent" })!;
  const mirror = { ...first, id: "hacker-news:48", externalId: "48", url: "https://mirror.example/agent",
    title: "  AI agent toolkit  ", importance: 5 };
  assert.deepEqual(deduplicateSignals([mirror, first]).map((item) => item.id), [first.id]);
});

test("ingestion retains each source observation for one canonical page", () => {
  const repository = normalizeGitHub({ id: 73, full_name: "example/agent-kit", created_at: "2026-09-23T12:00:00Z",
    html_url: "https://github.com/example/agent-kit", description: "An agent toolkit", stargazers_count: 25, fork: false })!;
  const discussion = normalizeHackerNews({ id: 74, type: "story", title: "Agent toolkit discussion", time: 1780000000,
    score: 12, url: "https://github.com/example/agent-kit?utm_source=hn" })!;
  const observations = uniqueSourceObservations([discussion, repository, { ...discussion, importance: 1 }]);
  assert.deepEqual(new Set(observations.map((item) => item.id)), new Set([discussion.id, repository.id]));
  assert.equal(deduplicateSignals(observations).length, 1);
});

test("feed selection keeps mapped signals before applying the cap or deduplicating", () => {
  const mapped = normalizeHackerNews({ id: 71, type: "story", title: "AI agent toolkit", time: Date.parse("2026-09-22T12:00:00Z") / 1000, score: 2, url: "https://example.com/agent" })!;
  const unmapped = { ...mapped, id: "hacker-news:72", externalId: "72", title: "Garden calendar", topics: [], importance: 99, publishedAt: "2026-09-23T12:00:00Z" };
  const second = normalizeGitHub({ id: 73, full_name: "example/database", created_at: "2026-09-21T12:00:00Z", html_url: "https://github.com/example/database", description: "Open source database", stargazers_count: 20, fork: false })!;
  const input = [unmapped, mapped, second];
  assert.deepEqual(selectFeedEvents(input, 2).map((event) => event.id), [mapped.id, second.id]);
  assert.ok(mapped.classificationInput);
  assert.equal(selectFeedEvents(input, 2)[0].classificationInput, undefined);
  assert.equal(input.length, 3);
});

test("region highlights surface the newest thread stories without losing region scope", () => {
  const oldBare = normalizeHackerNews({ id: 81, type: "story", title: "AI announcement", time: Date.parse("2026-09-22T08:00:00Z") / 1000, url: "https://example.com/old" })!;
  const newerThread = normalizeHackerNews({ id: 82, type: "story", title: "AI coding agents", time: Date.parse("2026-09-23T08:00:00Z") / 1000, url: "https://example.com/new" })!;
  const unrelated = normalizeHackerNews({ id: 83, type: "story", title: "New nuclear reactor", time: Date.parse("2026-09-24T08:00:00Z") / 1000, url: "https://example.com/energy" })!;
  assert.equal(newerThread.topics[0]?.subtopicId, "ai-coding-agents");
  assert.equal(oldBare.topics[0]?.subtopicId, null);
  assert.deepEqual(selectRegionHighlights([oldBare, unrelated, newerThread], "ai", 2).map((event) => event.id), [newerThread.id, oldBare.id]);
});

test("focused exploration reaches a recent niche source beyond the map sample", () => {
  const map = normalizeHackerNews({ id: 91, type: "story", title: "AI coding agents", time: Date.parse("2026-09-24T08:00:00Z") / 1000, url: "https://example.com/agents" })!;
  const niche = normalizeHackerNews({ id: 92, type: "story", title: "New nuclear reactor", time: Date.parse("2026-09-23T08:00:00Z") / 1000, url: "https://example.com/reactor" })!;
  const mirror = { ...niche, id: "hacker-news:93", externalId: "93", url: "https://mirror.example/reactor" };
  assert.deepEqual(selectFocusedSignals([map], [niche, mirror], "energy").map((item) => item.id), [niche.id]);
  assert.deepEqual(selectFocusedSignals([map], [niche], "ai"), [map]);
});

test("nearby ideas skip alternate headlines about the same incident", () => {
  const candidates = [
    { title: "OpenAI agent infiltrated Australian government website, PM says" },
    { title: "Early rogue AI agent activity found on urlquery.net" },
    { title: "OpenAI agent hacked Australian government website, PM says" },
    { title: "New benchmark for detecting prompt injection in agents" },
  ];
  assert.deepEqual(selectDistinctHeadlines(candidates, 3), [candidates[0], candidates[1], candidates[3]]);
  assert.deepEqual(selectDistinctHeadlines(candidates, 3, [candidates[0].title]), [candidates[1], candidates[3]]);
  const origin = "OpenAI agents ‘infiltrated’ Australian government website";
  const live = [
    { title: "OpenAI agent ‘infiltrated’ Australian government website, PM says" },
    { title: "Australia says OpenAI agent hacked into government website" },
    { title: "OpenAI agents hacked Australian Medicare system" },
    { title: "Prompt injection benchmark for browser agents" },
  ];
  assert.deepEqual(selectDistinctHeadlines(live, 3, [origin]), [live[3]]);
});
