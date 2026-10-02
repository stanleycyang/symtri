import assert from "node:assert/strict";
import test from "node:test";
import { answerKnowledgeQuestion, answerQuestion, questionSpecificWords, questionTopics, shouldSearchKnowledge } from "./ask";
import type { SignalEvent, SignalFeed } from "../data/model";

const observedAt = "2026-09-22T12:00:00.000Z";
function event(id: string, title: string, topicId: string, subtopicId: string): SignalEvent {
  return { id: `github:${id}`, source: "github", externalId: id, title,
    url: `https://github.com/example/${id}`, summary: title, publishedAt: observedAt,
    importance: 60, topics: [{ topicId, subtopicId, relevance: 1 }] };
}
const agents = event("agents", "A coding agent for repositories", "ai", "ai-agents");
const nuclear = event("nuclear", "Small nuclear reactors for data centers", "energy", "energy-nuclear");
const feed: SignalFeed = {
  observedAt, events: [agents, nuclear],
  sources: { "hacker-news": "ok", github: "ok", arxiv: "ok", openalex: "unavailable" }, partial: false, scope: "sample",
};

test("comparisons retain separate evidence for both same-region subjects", () => {
  const coding = event("coding", "Coding agents edit repositories", "ai", "ai-coding-agents");
  const models = event("models", "Language models predict text", "ai", "ai-language-models");
  const result = answerQuestion("Compare coding agents and language models", { ...feed, events: [coding, models, agents] });
  assert.equal(result.intent, "comparison");
  assert.deepEqual(result.events.map((item) => item.id), [coding.id, models.id]);
  assert.deepEqual(result.evidenceGroups?.map((group) => group.eventIds), [[coding.id], [models.id]]);
  assert.equal(result.subtopicId, null);
});

test("comparisons rank retained thread evidence ahead of incidental mentions and title-only links",()=>{
  const incidental=event("incidental","A language model for agentic coding agents","ai","ai-language-models");
  const headline=event("headline","New coding agents","ai","ai-coding-agents");
  const paper={...event("paper","Compact documentation for coding agents","ai","ai-coding-agents"),
    evidence:{text:"The authors benchmark coding agents against repository issues. ".repeat(8),kind:"abstract" as const,url:"https://example.org/paper",attribution:"Paper authors",license:null,retrievedAt:observedAt}};
  const models=event("models","Language models predict text","ai","ai-language-models");
  const result=answerQuestion("Compare coding agents and language models",{...feed,events:[incidental,headline,models,paper]});
  assert.equal(result.events[0].id,paper.id);
  assert.ok(result.evidenceGroups?.[0].eventIds.includes(paper.id));
});

test("updates prefer substantive retained evidence over a newer title-only link",()=>{
  const headline={...event("headline","AI agents are changing everything","ai","ai-agents"),importance:100};
  const paper={...event("paper","A benchmark of AI agents using tools","ai","ai-agents"),importance:10,publishedAt:"2026-09-20T12:00:00Z",
    evidence:{text:"The authors evaluated AI agents using tools in a bounded benchmark. ".repeat(5),kind:"abstract" as const,url:"https://example.org/paper",attribution:"Paper authors",license:null,retrievedAt:observedAt}};
  assert.equal(answerQuestion("What's happening with AI agents?",{...feed,events:[headline,paper]}).events[0].id,paper.id);
});

test("agent updates retain study evidence alongside fresh repository and discussion activity",()=>{
  const article={...event("discussion","There are no rogue AI agents","ai","ai-agents"),importance:100,
    evidence:{text:"The author argues that AI agents reflect the incentives of their operators. ".repeat(5),kind:"article" as const,url:"https://example.org/opinion",attribution:"Post author",license:null,retrievedAt:observedAt}};
  const paper={...event("study","Runtime validation in agent workflows","ai","ai-agents"),source:"arxiv" as const,importance:25,publishedAt:"2026-09-20T12:00:00Z",
    evidence:{text:"The authors evaluate AI agents using a runtime validation benchmark. ".repeat(5),kind:"preprint" as const,url:"https://example.org/study",attribution:"Paper authors",license:null,retrievedAt:observedAt}};
  assert.equal(answerQuestion("What's happening with AI agents?",{...feed,events:[article,paper]}).events[0].id,paper.id);
});

test("connection evidence must match both subjects and requested nuclear context", () => {
  const direct = { ...nuclear, title: "Nuclear reactors supply electricity to AI data centers", summary: "Civil nuclear power for AI training",
    topics: [...nuclear.topics, { topicId: "ai", subtopicId: "ai-ai-infrastructure", relevance: 1 }] };
  const military = { ...direct, id: "military", title: "AI hallucination of nuclear components led to military attack", summary: "Military nuclear components" };
  const result = answerQuestion("What connects nuclear energy and AI?", { ...feed, events: [agents, military, direct] });
  assert.deepEqual(result.events.map((item) => item.id), [direct.id]);
  assert.equal(result.evidenceCount, 1);
});

test("an agents question navigates to its thread with real evidence", () => {
  const result = answerQuestion("What's happening with AI agents?", feed);
  assert.deepEqual(result.regionIds, ["ai"]);
  assert.equal(result.subtopicId, "ai-agents");
  assert.deepEqual(result.pathSteps.map((step) => step.label), ["AI", "Agents"]);
  assert.equal(result.events[0].id, agents.id);
  assert.equal(result.evidenceCount, 1);
  assert.match(result.summary, /1 observed signal matches Agents/);
  assert.equal(result.retrieval, "terms");
});

test("an empty historical answer refers to its snapshot", () => {
  const result = answerQuestion("What is happening with energy?", { ...feed, events: [], scope: "history" });
  assert.match(result.summary, /in this snapshot/);
  assert.doesNotMatch(result.summary, /feed continues to update/);
});

test("a cross-region question follows the map and discloses missing shared evidence", () => {
  const result = answerQuestion("What connects nuclear energy and AI?", feed);
  assert.deepEqual(result.regionIds, ["energy", "ai"]);
  assert.deepEqual(result.pathIds, ["energy", "ai"]);
  assert.deepEqual(result.pathSteps.map((step) => step.label), ["ENERGY", "Nuclear", "Power Demand", "AI Infrastructure", "AI"]);
  assert.match(result.summary, /No direct source supports/);
  assert.deepEqual(result.events, []);
});

test("a broad shared signal leads the evidence without claiming a nuclear connection", () => {
  const shared = { ...event("shared", "AI forecasts solar output", "ai", "ai-agents"),
    topics: [{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }, { topicId: "energy", subtopicId: "energy-solar", relevance: 1 }] };
  const result = answerQuestion("What connects nuclear energy and AI?", { ...feed, events: [agents, nuclear, shared] });
  assert.deepEqual(result.events, []);
  assert.equal(result.evidenceCount, 0);
  assert.match(result.summary, /No direct source supports/);
});

test("the curated route reverses with question order and stays out of broad questions", () => {
  const reversed = answerQuestion("How does AI connect to nuclear energy?", feed);
  assert.deepEqual(reversed.pathSteps.map((step) => step.label), ["AI", "AI Infrastructure", "Power Demand", "Nuclear", "ENERGY"]);
  const broad = answerQuestion("How does AI connect to energy?", feed);
  assert.deepEqual(broad.pathSteps.map((step) => step.label), ["AI", "ENERGY"]);
});

test("a cross-region answer names a region absent from current observations", () => {
  const result = answerQuestion("What connects nuclear energy and AI?", { ...feed, events: [agents] });
  assert.match(result.summary, /No direct source supports/);
  assert.deepEqual(result.events, []);
});

test("a connection answer does not substitute separate region stories", () => {
  const oldAi = { ...agents, publishedAt: "2026-09-20T12:00:00.000Z" };
  const recentAi = { ...event("recent-ai", "New coding agent", "ai", "ai-agents"), publishedAt: "2026-09-22T11:00:00.000Z" };
  const extraEnergy = { ...event("solar", "Solar array update", "energy", "energy-solar"), publishedAt: "2026-09-22T11:30:00.000Z" };
  const result = answerQuestion("What connects nuclear energy and AI?", { ...feed, events: [oldAi, recentAi, nuclear, extraEnergy] });
  assert.deepEqual(result.events, []);
  assert.equal(result.evidenceCount, 0);
});

test("an open question selects the most active observed region", () => {
  const result = answerQuestion("What is drawing attention?", feed);
  assert.equal(result.regionIds.length, 1);
  assert.ok(["ai", "energy"].includes(result.regionIds[0]));
});

test("a thread without exact evidence does not cite unrelated parent-region sources", () => {
  const result = answerQuestion("What is happening with AI robotics?", feed);
  assert.equal(result.subtopicId, "ai-robotics");
  assert.match(result.summary, /No observed signal matches Robotics right now/);
  assert.equal(result.evidenceCount, 0);
  assert.deepEqual(result.events, []);
  const climate = event("biotech", "Claude discovers a new enzyme", "science", "science-biotechnology");
  const climateResult = answerQuestion("What is new in climate science?", { ...feed, events: [climate] });
  assert.equal(climateResult.subtopicId, "science-climate-science");
  assert.deepEqual(climateResult.events, []);
  const broadHardware = event("esp32", "ESP32 runs Linux", "hardware", "hardware-devices");
  const semiconductorResult = answerQuestion("What is new in semiconductor design?", { ...feed, events: [broadHardware] });
  assert.equal(semiconductorResult.subtopicId, "hardware-semiconductors");
  assert.equal(semiconductorResult.evidenceCount, 0);
  assert.deepEqual(semiconductorResult.events, []);
  assert.match(semiconductorResult.summary, /No observed signal matches semiconductor design/);
});

test("a specific region question excludes nearby stories about only the broad subject", () => {
  const simulation = event("simulation", "Simulation of a battery cell", "energy", "energy-battery-storage");
  const recycling = event("recycling", "Battery recycling process improves material recovery", "energy", "energy-battery-storage");
  const question = "What is new in battery recycling?";
  assert.deepEqual(questionSpecificWords(question), ["recycling"]);
  assert.deepEqual(questionSpecificWords("What's happening with AI agents?"), []);
  assert.deepEqual(questionSpecificWords("How are AI agents?"), []);
  assert.deepEqual(questionSpecificWords("What connects AI and energy?"), []);
  const answered = answerQuestion(question, { ...feed, events: [simulation, recycling] }, [{ id: simulation.id, similarity: 1 }]);
  assert.deepEqual(answered.events.map((item) => item.id), [recycling.id]);
  const empty = answerQuestion(question, { ...feed, events: [simulation] });
  assert.equal(empty.evidenceCount, 0);
  assert.deepEqual(empty.events, []);
  assert.match(empty.summary, /No observed signal matches battery recycling/);
});

test("semantic similarity reorders sources only within the identified region", () => {
  const first = event("first", "Repository notes", "ai", "ai-agents");
  const second = event("second", "Tooling notes", "ai", "ai-agents");
  const unrelated = event("other", "Unrelated market notes", "markets", "markets-economy");
  const result = answerQuestion("What's happening with AI agents?", { ...feed, events: [first, second, unrelated] }, [
    { id: first.id, similarity: .1 }, { id: second.id, similarity: .9 }, { id: unrelated.id, similarity: 1 },
  ]);
  assert.deepEqual(result.events.map((item) => item.id), [second.id, first.id]);
  assert.equal(result.regionIds[0], "ai");
  assert.equal(result.retrieval, "semantic-assisted");
});

test("repeated headlines keep the newer source in an answer", () => {
  const old = { ...event("old-agents", "Coding agents for repositories", "ai", "ai-agents"),
    publishedAt: "2026-09-15T12:00:00.000Z", importance: 100,
    topics: [{ topicId: "ai", subtopicId: "ai-coding-agents", relevance: 1 }] };
  const recent = { ...event("recent-agents", "Coding agents for repositories", "ai", "ai-agents"),
    publishedAt: "2026-09-22T11:00:00.000Z", importance: 20,
    topics: [{ topicId: "ai", subtopicId: "ai-coding-agents", relevance: 1 }] };
  const result = answerQuestion("What's happening with AI coding agents?", { ...feed, events: [old, recent] });
  assert.deepEqual(result.events.map((item) => item.id), [recent.id]);
});

test("mapped and archive answers show distinct news instead of alternate headlines", () => {
  const first = event("first-news", "OpenAI agent infiltrated Australian government website, PM says", "ai", "ai-agents");
  const repeat = event("repeat-news", "OpenAI agent hacked Australian government website, PM says", "ai", "ai-agents");
  const other = event("other-news", "New benchmark for detecting prompt injection in agents", "ai", "ai-agents");
  const current = answerQuestion("What's happening with AI agents?", { ...feed, events: [first, repeat, other] });
  assert.deepEqual(current.events.map((item) => item.id), [other.id, first.id]);
  const archive = answerKnowledgeQuestion("Australian government AI", [first, repeat, other].map((item) => ({ event: item, similarity: null })));
  assert.deepEqual(archive.events.map((item) => item.id), [first.id, other.id]);
});

test("a question about council remarks can cite the matching AI source", () => {
  const remarks = event("council", "Anthropic CEO warns UN Security Council on AI risks", "ai", "ai-research");
  assert.deepEqual(questionSpecificWords("What did the UN Security Council say about AI?"), ["un", "security", "council"]);
  const result = answerQuestion("What did the UN Security Council say about AI?", { ...feed, events: [remarks] });
  assert.deepEqual(result.regionIds, ["ai"]);
  assert.deepEqual(result.events.map((item) => item.id), [remarks.id]);
});

test("a specific older source can outrank a newer broad source", () => {
  const specific = { ...event("specific", "Coding agents for repositories", "ai", "ai-agents"),
    publishedAt: "2026-09-15T12:00:00.000Z", importance: 20,
    topics: [{ topicId: "ai", subtopicId: "ai-coding-agents", relevance: 1 }] };
  const broad = { ...event("broad", "Agents for repositories", "ai", "ai-agents"),
    publishedAt: "2026-09-22T11:00:00.000Z", importance: 20,
    topics: [{ topicId: "ai", subtopicId: "ai-coding-agents", relevance: 1 }] };
  const result = answerQuestion("What's happening with AI coding agents?", { ...feed, events: [broad, specific] });
  assert.equal(result.events[0].id, specific.id);
});

test("unmapped subjects use the knowledge archive without inventing a map location", () => {
  assert.deepEqual(questionTopics("What's happening with AI agents?"), [{ id: "ai", childId: "ai-agents" }]);
  assert.deepEqual(questionTopics("What is drawing attention?"), []);
  assert.equal(shouldSearchKnowledge("What is happening with AI agents?"), false);
  assert.equal(shouldSearchKnowledge("What is drawing attention?"), false);
  assert.equal(shouldSearchKnowledge("What is new with urban gardening?"), true);
  assert.deepEqual(questionTopics("Don't we require emotions for doing research?"), []);
  assert.equal(shouldSearchKnowledge("Don't we require emotions for doing research?"), true);
  assert.deepEqual(questionTopics("What is new in AI research?"), [{ id: "ai", childId: "ai-research" }]);
  assert.deepEqual(questionTopics("Nokia Design Archive"), []);
  assert.deepEqual(questionTopics("What did the UN Security Council say?"), []);
  assert.deepEqual(questionTopics("Explain zorbital florist protocols"), []);
  assert.deepEqual(questionTopics("What is new in blockchain protocols?"), [{id:"crypto",childId:"crypto-protocols"}]);
  assert.equal(shouldSearchKnowledge("What did the UN Security Council say?"), true);
  assert.deepEqual(questionTopics("What is happening with AI security?"), [{ id: "ai", childId: null }, { id: "security", childId: null }]);
  assert.equal(shouldSearchKnowledge("Nokia Design Archive"), true);
  assert.deepEqual(questionTopics("What is new in startup design?"), [{ id: "startups", childId: "startups-design" }]);
  for (const question of ["What is new in population growth?", "What is new in product packaging?", "What is new in computer networks?"]) {
    assert.deepEqual(questionTopics(question), []);
    assert.equal(shouldSearchKnowledge(question), true);
  }
  assert.deepEqual(questionTopics("What is new in startup growth?"), [{ id: "startups", childId: "startups-growth" }]);
  assert.deepEqual(questionTopics("What is new in product launch startups?"), [{ id: "startups", childId: "startups-product" }]);
  assert.deepEqual(questionTopics("What is new in network hardware?"), [{ id: "hardware", childId: "hardware-networks" }]);
  assert.deepEqual(questionTopics("What is new in semiconductor design?"), [{ id: "hardware", childId: "hardware-semiconductors" }]);
  assert.deepEqual(questionSpecificWords("What is new in semiconductor design?"), ["design"]);
  const garden = { ...event("garden", "Urban gardens", "science", "science-climate-science"), topics: [] };
  const result = answerKnowledgeQuestion("What is new with urban gardening?", [{ event: garden, similarity: .7 }]);
  assert.equal(result.scope, "knowledge");
  assert.deepEqual(result.regionIds, []);
  assert.deepEqual(result.events.map((item) => item.id), [garden.id]);
});

test("classified archive evidence guides the map without broadening the source answer", () => {
  const paper = event("exoplanet", "Exoplanet atmospheres observed with JWST", "space", "space-astronomy");
  const result = answerKnowledgeQuestion("What is new in exoplanet research?", [{ event: paper, similarity: null }]);
  assert.deepEqual(result.regionIds, ["space"]);
  assert.deepEqual(result.pathSteps.map((step) => step.label), ["SPACE", "Astronomy"]);
  assert.equal(result.subtopicId, "space-astronomy");
  assert.deepEqual(result.events.map((item) => item.id), [paper.id]);
  const weak = { ...paper, topics: [{ ...paper.topics[0], relevance: .5 }] };
  assert.deepEqual(answerKnowledgeQuestion("Exoplanets", [{ event: weak, similarity: null }]).regionIds, []);
});

test("quantum computing questions navigate to the physics thread", () => {
  assert.deepEqual(questionTopics("What is happening with quantum computing?"), [{ id: "science", childId: "science-physics" }]);
  assert.equal(shouldSearchKnowledge("What is happening with quantum computing?"), false);
  const paper = event("quantum", "Quantum computing with shallow circuits", "science", "science-physics");
  const result = answerQuestion("What is happening with quantum computing?", { ...feed, events: [paper] });
  assert.deepEqual(result.pathSteps.map((step) => step.label), ["SCIENCE", "Physics"]);
  assert.deepEqual(result.events.map((item) => item.id), [paper.id]);
});

test("tokamak and stellarator questions navigate to fusion research", () => {
  const paper = event("tokamak", "Tokamak fusion confinement", "energy", "energy-fusion");
  for (const question of ["What's new with tokamaks?", "What is happening in stellarators?"]) {
    assert.deepEqual(questionTopics(question), [{ id: "energy", childId: "energy-fusion" }]);
    assert.equal(shouldSearchKnowledge(question), false);
    const result = answerQuestion(question, { ...feed, events: [paper] });
    assert.deepEqual(result.pathSteps.map((step) => step.label), ["ENERGY", "Fusion"]);
    assert.deepEqual(result.events.map((item) => item.id), [paper.id]);
  }
});

test("full-archive answers retain update and explanation intents and subjects",()=>{
  const research={...agents,title:"Exoplanet atmospheric research",summary:"A study of exoplanet atmospheres",topics:[]};
  const update=answerKnowledgeQuestion("What is new in exoplanet research?",[{event:research,similarity:null}]);
  assert.equal(update.intent,"update");assert.deepEqual(update.subjects,["exoplanet"]);
  const explanation=answerKnowledgeQuestion("Explain exoplanet research",[{event:research,similarity:null}]);
  assert.equal(explanation.intent,"explanation");assert.deepEqual(explanation.subjects,["exoplanet"]);
});

test("Ask source lists retain the evidence type separately from generated prose",()=>{
  const paper={...agents,source:"arxiv" as const,evidence:{text:"The authors evaluated AI agents using tools.",kind:"preprint" as const,url:agents.url,attribution:"Authors",license:null,retrievedAt:observedAt}};
  assert.equal(answerQuestion("What's happening with AI agents?",{...feed,events:[paper]}).events[0].sourceKind,"preprint");
  assert.equal(answerKnowledgeQuestion("What is new in exoplanet research?",[{event:paper,similarity:null}]).events[0].sourceKind,"preprint");
});
