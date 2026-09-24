import { regionActivity, regionRelationships, relationshipKey } from "../data/activity";
import type { SignalEvent, SignalFeed } from "../data/model";
import { knowledgeSearchQuery } from "../data/search";
import { selectDistinctHeadlines } from "../data/select";
import { seedCatalog, type UniverseCatalog } from "../universe";

export type AskResult = {
  question: string;
  summary: string;
  regionIds: string[];
  pathIds: string[];
  pathSteps: { regionId: string; subtopicId: string | null; label: string }[];
  subtopicId: string | null;
  evidenceCount: number;
  observedAt: string;
  scope: SignalFeed["scope"];
  retrieval: "terms" | "semantic-assisted";
  summaryKind: "sample" | "model";
  citedEventIds: string[];
  events: Pick<SignalEvent, "id" | "source" | "title" | "url" | "publishedAt">[];
};

const regionAliases: Record<string, string[]> = {
  ai: ["ai", "artificial intelligence", "machine learning", "llm", "language model", "agent", "agents"],
  software: ["software", "developer", "programming", "open source", "database"],
  science: ["science", "biology", "physics", "medicine", "quantum computing", "quantum computers", "qubits"],
  space: ["space", "satellite", "rocket", "astronomy"],
  energy: ["energy", "power demand", "electricity", "nuclear", "solar", "battery", "fusion", "tokamak", "tokamaks", "stellarator", "stellarators"],
  markets: ["markets", "economy", "finance", "investment", "venture capital"],
  security: ["security", "privacy", "cyber", "malware", "encryption"],
  hardware: ["hardware", "chip", "semiconductor", "gpu", "compute"],
  startups: ["startups", "founders", "funding", "new venture"],
  crypto: ["crypto", "bitcoin", "ethereum", "blockchain", "stablecoin"],
};

const subtopicAliases: Record<string, string[]> = {
  "ai-agents": ["agent", "agents", "agentic"],
  "ai-language-models": ["llm", "llms", "language model", "language models"],
  "ai-coding-agents": ["coding agent", "coding agents"],
  "ai-ai-infrastructure": ["ai infrastructure", "inference"],
  "ai-research": ["ai research", "artificial intelligence research", "machine learning research"],
  "science-physics": ["quantum computing", "quantum computers", "quantum physics", "qubits"],
  "energy-power-demand": ["power demand", "data center power"],
  "energy-nuclear": ["nuclear", "reactor", "smr"],
  "energy-fusion": ["fusion", "tokamak", "tokamaks", "stellarator", "stellarators"],
  "hardware-semiconductors": ["semiconductor", "semiconductors"],
  "hardware-networks": ["network hardware", "network devices", "hardware networks"],
  "startups-product": ["startup product", "product launch"],
  "startups-growth": ["startup growth", "company growth"],
  "startups-design": ["startup design", "design for startups"],
};

function firstMatch(question: string, phrases: string[]): number {
  let first = Infinity;
  for (const phrase of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "[ -]");
    const match = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").exec(question);
    if (match) first = Math.min(first, match.index);
  }
  return first;
}

function findPath(start: string, end: string, catalog: UniverseCatalog): string[] {
  if (start === end) return [start];
  const queue: string[][] = [[start]];
  const visited = new Set([start]);
  while (queue.length) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    for (const [a, b] of catalog.topicEdges) {
      const next = a === current ? b : b === current ? a : null;
      if (!next || visited.has(next)) continue;
      const candidate = [...path, next];
      if (next === end) return candidate;
      visited.add(next);
      queue.push(candidate);
    }
  }
  return [start, end];
}

function words(input: string): string[] {
  const stop = new Set(["what", "whats", "with", "about", "happening", "today", "this", "that", "where", "which", "between", "connects", "the", "and", "are", "how", "drawing", "attention"]);
  return input.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !stop.has(word)) ?? [];
}

export function questionTopics(question: string, catalog: UniverseCatalog = seedCatalog): { id: string; childId: string | null }[] {
  const routingQuestion = question.replace(/\bsecurity[ -]council\b/gi, "");
  return catalog.topics.map((topic) => {
    const regionPosition = firstMatch(routingQuestion, regionAliases[topic.id] ?? [topic.name.toLowerCase()]);
    const children = topic.children.map((child) => ({ id: child.id, position: firstMatch(routingQuestion, subtopicAliases[child.id] ?? [child.name.toLowerCase()]) }));
    const child = children.filter((item) => Number.isFinite(item.position)).sort((a, b) => a.position - b.position)[0];
    return { id: topic.id, position: Math.min(regionPosition, child?.position ?? Infinity), childId: child?.id ?? null };
  }).filter((item) => Number.isFinite(item.position)).sort((a, b) => a.position - b.position).slice(0, 2)
    .map(({ id, childId }) => ({ id, childId }));
}

export function shouldSearchKnowledge(question: string, catalog: UniverseCatalog = seedCatalog): boolean {
  return words(question).length > 0 && questionTopics(question, catalog).length === 0;
}

export function questionSpecificWords(question: string, catalog: UniverseCatalog = seedCatalog): string[] {
  const [detected, other] = questionTopics(question, catalog);
  if (!detected || other) return [];
  const region = catalog.topics.find((topic) => topic.id === detected.id)!;
  const child = region.children.find((item) => item.id === detected.childId);
  const aliases = [...(regionAliases[detected.id] ?? []), region.name,
    ...(child ? [...(subtopicAliases[child.id] ?? []), child.name] : [])];
  const mapped = new Set(aliases.flatMap((alias) => alias.toLowerCase().match(/[a-z0-9]+/g) ?? []));
  return (knowledgeSearchQuery(question).match(/[a-z0-9]+/g) ?? []).filter((word) => !mapped.has(word));
}

function matchesSpecificWords(event: SignalEvent, terms: string[]): boolean {
  const content = `${event.title} ${event.summary}`.toLowerCase();
  return terms.every((term) => {
    const root = term.replace(/(?:ing|ed|es|s)$/, "");
    return content.includes(root.length >= 4 ? root : term);
  });
}

export function answerKnowledgeQuestion(question: string, results: { event: SignalEvent; similarity: number | null }[], catalog: UniverseCatalog = seedCatalog): AskResult {
  const selected = selectDistinctHeadlines(results.map((item) => ({ ...item, title: item.event.title })), 4);
  const location = selected[0]?.event.topics.find((match) => match.relevance >= .67 && catalog.topics.some((topic) => topic.id === match.topicId));
  const region = location ? catalog.topics.find((topic) => topic.id === location.topicId)! : null;
  const child = region?.children.find((item) => item.id === location?.subtopicId);
  return {
    question,
    summary: selected.length ? `The knowledge archive has ${results.length} source${results.length === 1 ? "" : "s"} related to this question. The closest sources are linked below; this sample does not establish a broad trend.` : "No indexed source matches this question yet. The universe is still growing from its connected sources.",
    regionIds: region ? [region.id] : [], pathIds: region ? [region.id] : [],
    pathSteps: region ? [{ regionId: region.id, subtopicId: null, label: region.short },
      ...(child ? [{ regionId: region.id, subtopicId: child.id, label: child.name }] : [])] : [],
    subtopicId: child?.id ?? null,
    evidenceCount: results.length, observedAt: new Date().toISOString(), scope: "knowledge",
    retrieval: selected.some((item) => item.similarity !== null) ? "semantic-assisted" : "terms",
    summaryKind: "sample", citedEventIds: [],
    events: selected.map(({ event }) => ({ id: event.id, source: event.source, title: event.title, url: event.url, publishedAt: event.publishedAt })),
  };
}

export function answerQuestion(question: string, feed: SignalFeed, semanticMatches: { id: string; similarity: number }[] = []): AskResult {
  const catalog = feed.catalog ?? seedCatalog;
  const detected = questionTopics(question, catalog);
  const fallback = Object.entries(regionActivity(feed.events, Date.parse(feed.observedAt), catalog)).sort((a, b) => b[1].score - a[1].score)[0]?.[0] ?? "ai";
  const regionIds = detected.length ? detected.map((item) => item.id) : [fallback];
  const subtopicId = regionIds.length === 1 ? detected[0]?.childId ?? null : null;
  const pathIds = regionIds.length === 2 ? findPath(regionIds[0], regionIds[1], catalog) : regionIds;
  const regionStep = (id: string) => ({ regionId: id, subtopicId: null, label: catalog.topics.find((topic) => topic.id === id)!.short });
  const childStep = (id: string) => {
    const region = catalog.topics.find((topic) => topic.children.some((child) => child.id === id))!;
    return { regionId: region.id, subtopicId: id, label: region.children.find((child) => child.id === id)!.name };
  };
  const energyAi = regionIds.length === 2 && regionIds.includes("energy") && regionIds.includes("ai") && detected.some((item) => item.childId === "energy-nuclear");
  const energyAiSteps = [regionStep("energy"), childStep("energy-nuclear"), childStep("energy-power-demand"), childStep("ai-ai-infrastructure"), regionStep("ai")];
  const pathSteps = energyAi
    ? regionIds[0] === "energy" ? energyAiSteps : [...energyAiSteps].reverse()
    : regionIds.length === 1 && subtopicId ? [regionStep(regionIds[0]), childStep(subtopicId)] : pathIds.map(regionStep);
  const queryWords = words(question);
  const specificWords = regionIds.length === 1 ? questionSpecificWords(question, catalog) : [];
  const matching = feed.events.filter((event) => event.topics.some((match) => regionIds.includes(match.topicId)));
  const scoped = subtopicId ? matching.filter((event) => event.topics.some((match) => match.subtopicId === subtopicId)) : matching;
  const candidates = scoped.filter((event) => matchesSpecificWords(event, specificWords));
  const semanticScores = new Map(semanticMatches.filter((match) => Number.isFinite(match.similarity)).map((match) => [match.id, Math.max(0, Math.min(1, match.similarity))]));
  const observedAt = Date.parse(feed.observedAt);
  const score = (event: SignalEvent) => {
    const text = `${event.title} ${event.summary}`.toLowerCase();
    const overlap = queryWords.filter((word) => text.includes(word)).length;
    const shared = regionIds.length === 2 && regionIds.every((id) => event.topics.some((match) => match.topicId === id));
    const ageHours = (observedAt - Date.parse(event.publishedAt)) / 3_600_000;
    const freshness = Number.isFinite(ageHours) ? 5 * 2 ** (-Math.max(0, ageHours) / 48) : 0;
    return overlap * 5 + (shared ? 15 : 0) + event.importance / 25 + (semanticScores.get(event.id) ?? 0) * 6 + freshness;
  };
  const ranked = candidates.map((event) => ({ event, rank: score(event) }))
    .sort((a, b) => b.rank - a.rank || b.event.publishedAt.localeCompare(a.event.publishedAt))
    .map(({ event }) => event);
  const sharedEvents = regionIds.length === 2
    ? ranked.filter((event) => regionIds.every((id) => event.topics.some((match) => match.topicId === id)))
    : [];
  const selected: SignalEvent[] = [];
  if (regionIds.length === 2) {
    if (sharedEvents[0]) selected.push(sharedEvents[0]);
    for (const id of regionIds) {
      const childId = detected.find((item) => item.id === id)?.childId;
      const regionEvents = ranked.filter((item) => item.topics.some((match) => match.topicId === id) && !selected.includes(item));
      const childEvents = childId ? regionEvents.filter((item) => item.topics.some((match) => match.subtopicId === childId)) : [];
      const choices = [...(childEvents.length ? childEvents : regionEvents)].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      const event = selectDistinctHeadlines(choices, 1, selected.map((item) => item.title))[0] ?? choices[0];
      if (event) selected.push(event);
    }
  } else {
    selected.push(...selectDistinctHeadlines(ranked, 4));
  }

  const names = regionIds.map((id) => catalog.topics.find((topic) => topic.id === id)!.name);
  const missingRegions = regionIds.filter((id) => !matching.some((event) => event.topics.some((match) => match.topicId === id)));
  const childName = subtopicId ? catalog.topics.flatMap((topic) => topic.children).find((child) => child.id === subtopicId)?.name : null;
  const crossChild = regionIds.length === 2 ? detected.find((item) => item.childId)?.childId : null;
  const crossChildName = crossChild ? catalog.topics.flatMap((topic) => topic.children).find((child) => child.id === crossChild)?.name : null;
  const crossChildShared = crossChild ? sharedEvents.some((event) => event.topics.some((match) => match.subtopicId === crossChild)) : true;
  const sharedCount = regionIds.length === 2 ? regionRelationships(feed.events, Date.parse(feed.observedAt), catalog)[relationshipKey(regionIds[0], regionIds[1])] ?? 0 : 0;
  let summary: string;
  if (regionIds.length === 2) {
    summary = sharedCount
      ? `${sharedCount} sampled signal${sharedCount === 1 ? "" : "s"} ${sharedCount === 1 ? "links" : "link"} ${names[0]} and ${names[1]}. ${crossChildName && !crossChildShared ? `None of those shared signals is tagged ${crossChildName}; the sources show nearby activity.` : `The first source is classified to both regions.`}`
      : missingRegions.length
        ? `No sampled signal connects ${names[0]} and ${names[1]}. ${missingRegions.map((id) => catalog.topics.find((topic) => topic.id === id)!.name).join(" and ")} ${missingRegions.length === 1 ? "has" : "have"} no source in this sample${candidates.length ? "; the links below are from the other region" : ""}.`
      : `The map links ${names[0]} and ${names[1]}, but this sample has no signal classified to both. The sources below show each region separately.`;
  } else if (specificWords.length && !candidates.length && matching.length) {
    summary = `No sampled signal matches ${knowledgeSearchQuery(question)} ${feed.scope === "history" ? "in this snapshot" : "right now"}. The map shows broader ${names[0]} activity, but it does not establish an update on this subject.`;
  } else if (subtopicId && !scoped.length && matching.length) {
    summary = `No sampled signal matches ${childName} ${feed.scope === "history" ? "in this snapshot" : "right now"}. The map shows broader ${names[0]} activity, but it does not establish an update on this thread.`;
  } else if (candidates.length) {
    summary = `${candidates.length} sampled signal${candidates.length === 1 ? " matches" : "s match"} ${specificWords.length ? knowledgeSearchQuery(question) : childName ?? names[0]}. One leading source is “${selected[0].title}” (${selected[0].source === "hacker-news" ? "Hacker News" : selected[0].source === "arxiv" ? "arXiv" : selected[0].source === "openalex" ? "OpenAlex" : "GitHub"}).`;
  } else {
    summary = feed.scope === "history"
      ? `No sampled signal matches ${childName ?? names[0]} in this snapshot. Explore another date or region.`
      : `No sampled signal matches ${childName ?? names[0]} right now. Explore the region while the feed continues to update.`;
  }
  return {
    question, summary, regionIds, pathIds, pathSteps, subtopicId,
    evidenceCount: candidates.length, observedAt: feed.observedAt, scope: feed.scope,
    retrieval: selected.some((event) => semanticScores.has(event.id)) ? "semantic-assisted" : "terms",
    summaryKind: "sample", citedEventIds: [],
    events: selected.map(({ id, source, title, url, publishedAt }) => ({ id, source, title, url, publishedAt })),
  };
}
