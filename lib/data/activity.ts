import type { SignalEvent } from "./model";
import { seedCatalog, type UniverseCatalog } from "../universe";

export type RegionActivity = {
  count: number;
  score: number;
  recent: number;
  previous: number;
  momentum: "rising" | "steady" | "quiet";
  visual: number;
};

export type RegionRelationships = Record<string, number>;
type ActivityTotals = Pick<RegionActivity, "count" | "score" | "recent" | "previous">;

export function completeRegionActivity(totals: Partial<Record<string, ActivityTotals>>, catalog: UniverseCatalog = seedCatalog): Record<string, RegionActivity> {
  const result = Object.fromEntries(catalog.topics.map((topic) => [topic.id, {
    count: totals[topic.id]?.count ?? 0,
    score: totals[topic.id]?.score ?? 0,
    recent: totals[topic.id]?.recent ?? 0,
    previous: totals[topic.id]?.previous ?? 0,
    momentum: "quiet" as RegionActivity["momentum"], visual: 18,
  }])) as Record<string, RegionActivity>;
  const maxScore = Math.max(1, ...Object.values(result).map((region) => region.score));
  for (const region of Object.values(result)) {
    region.visual = Math.round(18 + 82 * Math.sqrt(region.score / maxScore));
    region.momentum = region.recent >= 1.5 && region.recent > region.previous * 1.5 + .5
      ? "rising" : region.recent > 0 || region.previous > 0 ? "steady" : "quiet";
  }
  return result;
}

export function relationshipKey(first: string, second: string): string {
  return [first, second].sort().join(":");
}

// Keep established routes in place while limiting new, data-led connections.
// Older archive links remain available in the detail panel but do not animate
// as current attention after their shared signals leave the rolling sample.
export function attentionEdges(recent: RegionRelationships | null, catalog: UniverseCatalog = seedCatalog): [string, string][] {
  if (!recent) return catalog.topicEdges;
  const base = new Set(catalog.topicEdges.map(([first, second]) => relationshipKey(first, second)));
  const known = new Set(catalog.topics.map((topic) => topic.id));
  const emerging = Object.entries(recent)
    .filter(([key, count]) => {
      const [first, second] = key.split(":");
      return count >= 2 && !base.has(key) && known.has(first) && known.has(second);
    })
    .sort(([firstKey, firstCount], [secondKey, secondCount]) => secondCount - firstCount || firstKey.localeCompare(secondKey))
    .slice(0, 6)
    .map(([key]) => key.split(":") as [string, string]);
  return [...catalog.topicEdges, ...emerging];
}

export function flowingAttentionEdges(edges: [string, string][], recent: RegionRelationships | null): [string, string][] {
  return recent ? edges.filter(([first, second]) => (recent[relationshipKey(first, second)] ?? 0) > 0) : edges;
}

// Co-classification is evidence that a sampled signal connects two regions.
// Repeated observations strengthen a connection without changing node positions.
export function regionRelationships(events: SignalEvent[], now = Date.now(), catalog: UniverseCatalog = seedCatalog): RegionRelationships {
  const relationships: RegionRelationships = {};
  const known = new Set(catalog.topics.map((topic) => topic.id));
  for (const event of events) {
    const ageHours = (now - new Date(event.publishedAt).getTime()) / HOUR;
    if (!Number.isFinite(ageHours) || ageHours < -1 || ageHours > 14 * 24) continue;
    const ids = [...new Set(event.topics.map((match) => match.topicId).filter((id) => known.has(id)))];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const key = relationshipKey(ids[i], ids[j]);
      relationships[key] = (relationships[key] ?? 0) + 1;
    }
  }
  return relationships;
}

const HOUR = 3_600_000;

// This measures attention within the sampled feed, not total activity on any source.
// An event contributes once per region, weighted by classification, importance, and
// an exponential 24-hour decay. Equal 24-hour windows make momentum interpretable.
export function regionActivity(events: SignalEvent[], now = Date.now(), catalog: UniverseCatalog = seedCatalog): Record<string, RegionActivity> {
  const totals = Object.fromEntries(catalog.topics.map((topic) => [topic.id, {
    count: 0, score: 0, recent: 0, previous: 0,
  }])) as Record<string, ActivityTotals>;

  for (const event of events) {
    const ageHours = (now - new Date(event.publishedAt).getTime()) / HOUR;
    if (!Number.isFinite(ageHours) || ageHours < -1 || ageHours > 14 * 24) continue;
    const byRegion = new Map<string, number>();
    for (const match of event.topics) {
      if (totals[match.topicId]) byRegion.set(match.topicId, Math.max(byRegion.get(match.topicId) ?? 0, Math.max(0, Math.min(1, match.relevance))));
    }
    for (const [id, relevance] of byRegion) {
      const region = totals[id];
      const weight = relevance * (.6 + Math.min(100, Math.max(0, event.importance)) / 200);
      region.count++;
      region.score += weight * 2 ** (-Math.max(0, ageHours) / 24);
      if (ageHours < 24) region.recent += weight;
      else if (ageHours < 48) region.previous += weight;
    }
  }

  return completeRegionActivity(totals, catalog);
}
