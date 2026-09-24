export type SourceId = "hacker-news" | "github" | "arxiv";

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
};

export type RelatedSignal = Pick<SignalEvent, "id" | "source" | "title" | "url" | "summary" | "publishedAt" | "topics">;

export type SourceStatus = Record<SourceId, "ok" | "partial" | "unavailable">;

export type SignalFeed = {
  observedAt: string;
  events: SignalEvent[];
  sources: SourceStatus;
  partial: boolean;
  scope: "sample" | "rolling" | "archive" | "history" | "knowledge";
  archiveCount?: number;
  knowledgeGraph?: { updatedAt: string; regionCounts: Record<string, number>; relationships: Record<string, number> };
  semanticRelationships?: Record<string, number>;
};

export type SnapshotDay = { day: string; capturedAt: string; eventCount: number };
