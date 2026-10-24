import { evidenceFingerprint } from "./enrichment-policy";
import type { SignalFeed } from "./model";

export type SourceCheckpoint = SignalFeed & {
  evidenceRefs?: Record<string, { contentHash: string; retrievedAt: string }>;
};

/** Keep exact observation identities without putting source bodies in Workflow checkpoints. */
export function sourceCheckpoint(feed: SignalFeed): SourceCheckpoint {
  const evidenceRefs: NonNullable<SourceCheckpoint["evidenceRefs"]> = {};
  const events = feed.events.map(event => {
    if (event.evidence?.text) {
      // Match persistSourceEvidence's stored body, including its size bound.
      const body = { ...event.evidence, text: event.evidence.text.slice(0, 12000) };
      evidenceRefs[event.id] = { contentHash: evidenceFingerprint(body), retrievedAt: body.retrievedAt };
    }
    const visible = { ...event };
    delete visible.evidence;
    return visible;
  });
  return { ...feed, events, evidenceRefs };
}
