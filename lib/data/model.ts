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
};

export type SourceStatus = Record<SourceId, "ok" | "unavailable">;

export type SignalFeed = {
  observedAt: string;
  events: SignalEvent[];
  sources: SourceStatus;
  partial: boolean;
  scope: "sample" | "archive" | "history";
  semanticRelationships?: Record<string, number>;
};

export type SnapshotDay = { day: string; capturedAt: string; eventCount: number };
