import { seedCatalog, type UniverseCatalog } from "../universe";
import { attentionEdges, regionRelationships, relationshipKey } from "./activity";
import type { SignalFeed } from "./model";

export function threadCounts(feed: SignalFeed | null): Record<string, number> {
  if (!feed) return {};
  if (feed.scope !== "history" && feed.childCounts) return feed.childCounts;
  const counts: Record<string, number> = {};
  for (const event of feed.events) {
    for (const id of new Set(event.topics.map((match) => match.subtopicId).filter((id): id is string => Boolean(id)))) {
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return counts;
}

export function threadOrigin(id: string): string {
  return seedCatalog.topics.some((topic) => topic.children.some((child) => child.id === id))
    ? "This is a starting thread in the map. It stays available even when no recent source matches."
    : "This thread grew from repeated source evidence. Its earlier sources may now be outside the recent window.";
}

export function connectionsFor(regionId: string, feed: SignalFeed | null, catalog: UniverseCatalog) {
  const relationships = feed ? feed.relationships ?? regionRelationships(feed.events, Date.parse(feed.observedAt), catalog) : null;
  const visible = new Set(attentionEdges(relationships, catalog)
    .filter(([a, b]) => a === regionId || b === regionId).map(([a, b]) => a === regionId ? b : a));
  return catalog.topics.filter((topic) => topic.id !== regionId).map((topic) => {
    const key = relationshipKey(regionId, topic.id);
    const recent = relationships?.[key] ?? 0;
    const archived = feed?.scope === "history" ? 0 : feed?.knowledgeGraph?.relationships[key] ?? 0;
    const seeded = catalog.topicEdges.some(([a, b]) => relationshipKey(a, b) === key);
    return { topic, recent, archived, seeded, visible: visible.has(topic.id) };
  }).filter((item) => item.visible || item.recent > 0 || item.archived > 0)
    .sort((a, b) => Number(b.visible) - Number(a.visible) || b.recent - a.recent || b.archived - a.archived);
}
