import type { RegionActivity } from "./activity";
import type { RegionRelationships } from "./activity";
import type { UniverseCatalog } from "../universe";

export type SourceId = string;

export type SourceEvidence = {
  text: string;
  kind: "abstract" | "preprint" | "feed" | "advisory" | "model-card" | "dataset-card" | "repository" | "article";
  url: string;
  attribution: string;
  license: string | null;
  retrievedAt: string;
  metadata?: Record<string, string | number | boolean>;
};

export type TopicMatch = {
  topicId: string;
  subtopicId: string | null;
  relevance: number;
};

export type SignalEvent = {
  id: string;
  source: SourceId;
  externalId: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
  importance: number;
  topics: TopicMatch[];
  classificationInput?: { title: string; summary: string; categories: string[] };
  evidence?: SourceEvidence;
};

export type RelatedSignal = Pick<SignalEvent, "id" | "source" | "title" | "url" | "summary" | "publishedAt" | "topics">;

export type SourceStatus = Record<SourceId, "ok" | "partial" | "unavailable">;

export function unavailableSources(includeCurated = false): SourceStatus {
  return { "hacker-news": "unavailable", github: "unavailable", arxiv: "unavailable", openalex: "unavailable",
    ...(includeCurated ? { nasa: "unavailable", "nasa-jpl": "unavailable", cisa: "unavailable", "europe-pmc": "unavailable", "hugging-face": "unavailable" } as SourceStatus : {}) };
}

export type SignalFeed = {
  observedAt: string;
  lastIngestedAt?: string;
  events: SignalEvent[];
  sources: SourceStatus;
  partial: boolean;
  scope: "sample" | "rolling" | "archive" | "history" | "knowledge";
  archiveCount?: number;
  classifierVersion?: number;
  childCounts?: Record<string, number>;
  activity?: Record<string, RegionActivity>;
  relationships?: RegionRelationships;
  knowledgeGraph?: { updatedAt: string; regionCounts: Record<string, number>; relationships: RegionRelationships; recentRelationships?: RegionRelationships };
  semanticRelationships?: Record<string, number>;
  catalog?: UniverseCatalog;
};

export type SnapshotDay = { day: string; capturedAt: string; eventCount: number; archiveCount?: number };
