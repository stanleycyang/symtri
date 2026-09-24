import type { SignalEvent } from "./model";
import { topicEdges, topics } from "../universe";

export type RegionActivity = {
  count: number;
  score: number;
  recent: number;
  previous: number;
  momentum: "rising" | "steady" | "quiet";
  visual: number;
};

export type RegionRelationships = Record<string, number>;

export function relationshipKey(first: string, second: string): string {
  return [first, second].sort().join(":");
}

// Keep established routes in place while limiting new, data-led connections.
// Older archive links remain available in the detail panel but do not animate
// as current attention after their shared signals leave the rolling sample.
export function attentionEdges(recent: RegionRelationships | null): [string, string][] {
  if (!recent) return topicEdges;
  const base = new Set(topicEdges.map(([first, second]) => relationshipKey(first, second)));
  const known = new Set(topics.map((topic) => topic.id));
  const emerging = Object.entries(recent)
    .filter(([key, count]) => {
      const [first, second] = key.split(":");
      return count >= 2 && !base.has(key) && known.has(first) && known.has(second);
    })
    .sort(([firstKey, firstCount], [secondKey, secondCount]) => secondCount - firstCount || firstKey.localeCompare(secondKey))
    .slice(0, 6)
    .map(([key]) => key.split(":") as [string, string]);
  return [...topicEdges, ...emerging];
}

export function flowingAttentionEdges(edges: [string, string][], recent: RegionRelationships | null): [string, string][] {
  return recent ? edges.filter(([first, second]) => (recent[relationshipKey(first, second)] ?? 0) > 0) : edges;
}

// Co-classification is evidence that a sampled signal connects two regions.
// Repeated observations strengthen a connection without changing node positions.
export function regionRelationships(events: SignalEvent[], now = Date.now()): RegionRelationships {
  const relationships: RegionRelationships = {};
  const known = new Set(topics.map((topic) => topic.id));
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
export function regionActivity(events: SignalEvent[], now = Date.now()): Record<string, RegionActivity> {
  const result = Object.fromEntries(topics.map((topic) => [topic.id, {
    count: 0, score: 0, recent: 0, previous: 0,
    momentum: "quiet" as RegionActivity["momentum"], visual: 18,
  }])) as Record<string, RegionActivity>;

  for (const event of events) {
    const ageHours = (now - new Date(event.publishedAt).getTime()) / HOUR;
    if (!Number.isFinite(ageHours) || ageHours < -1 || ageHours > 14 * 24) continue;
    const byRegion = new Map<string, number>();
    for (const match of event.topics) {
      if (result[match.topicId]) byRegion.set(match.topicId, Math.max(byRegion.get(match.topicId) ?? 0, Math.max(0, Math.min(1, match.relevance))));
    }
    for (const [id, relevance] of byRegion) {
      const region = result[id];
      const weight = relevance * (.6 + Math.min(100, Math.max(0, event.importance)) / 200);
      region.count++;
      region.score += weight * 2 ** (-Math.max(0, ageHours) / 24);
      if (ageHours < 24) region.recent += weight;
      else if (ageHours < 48) region.previous += weight;
    }
  }

  const maxScore = Math.max(1, ...Object.values(result).map((region) => region.score));
  for (const region of Object.values(result)) {
    region.visual = Math.round(18 + 82 * Math.sqrt(region.score / maxScore));
    region.momentum = region.recent >= 1.5 && region.recent > region.previous * 1.5 + .5
      ? "rising" : region.recent > 0 || region.previous > 0 ? "steady" : "quiet";
  }
  return result;
}
