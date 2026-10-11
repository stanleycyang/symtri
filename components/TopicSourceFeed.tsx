"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SignalEvent } from "@/lib/data/model";

type Page = {
  events: SignalEvent[];
  nextCursor: string | null;
  requestedCursor: string | null;
  loading: boolean;
  error: boolean;
};

export default function TopicSourceFeed({ regionId, childId, hidden, archive, snapshot, initialEvents, unavailableIds, sourceLabel, dateLabel, onSelect }: {
  regionId: string;
  childId: string | null;
  hidden: boolean;
  archive: boolean;
  snapshot: boolean;
  initialEvents: SignalEvent[];
  unavailableIds: Set<string>;
  sourceLabel: (event: SignalEvent) => string;
  dateLabel: (event: SignalEvent) => string;
  onSelect: (event: SignalEvent, control: HTMLButtonElement) => void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [sampleLimit, setSampleLimit] = useState(20);
  const request = useRef<AbortController | null>(null);
  const fetchPage = useCallback(async (cursor: string | null = null) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const params = new URLSearchParams({ regionId, browse: "1" });
    if (childId) params.set("childId", childId);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/topic?${params}`, { cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!response.ok) throw new Error("Sources unavailable");
      const next: { events: SignalEvent[]; nextCursor: string | null } = await response.json();
      if (!Array.isArray(next.events)) throw new Error("Invalid source page");
      return controller.signal.aborted ? null : next;
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    }
  }, [regionId, childId]);

  const receivePage = useCallback((next: { events: SignalEvent[]; nextCursor: string | null } | null, cursor: string | null) => {
    if (!next) return;
    setPage(previous => {
      const events = cursor ? [...(previous?.events ?? []), ...next.events] : next.events;
      return { events: [...new Map(events.map(event => [event.id, event])).values()],
        nextCursor: next.nextCursor, requestedCursor: cursor, loading: false, error: false };
    });
  }, []);
  const failPage = useCallback((cursor: string | null) => {
    setPage(previous => ({ events: previous?.events ?? [], nextCursor: previous?.nextCursor ?? null,
      requestedCursor: cursor, loading: false, error: true }));
  }, []);

  useEffect(() => {
    if (archive) void fetchPage().then(next => receivePage(next, null)).catch(() => failPage(null));
    return () => { request.current?.abort(); };
  }, [archive, fetchPage, receivePage, failPage]);

  const events = (archive && page ? page.events : initialEvents.slice(0, sampleLimit))
    .filter(event => !unavailableIds.has(event.id));
  const more = archive ? Boolean(page?.nextCursor) : sampleLimit < initialEvents.length;
  const loading = archive && (!page || page.loading);

  return <section className="topic-source-feed" aria-label="Sources for this point" hidden={hidden} inert={hidden}>
    <div className="panel-section-title"><span>{snapshot ? "SOURCES IN THIS SNAPSHOT" : "LATEST READABLE SOURCES"}</span><span>{events.length} SHOWN</span></div>
    <p className="source-feed-scope">{snapshot ? "Browse the saved sample from this date." : archive ? "Newest first. Keep exploring to reach earlier sources in the archive." : "Sources in the current sample."}</p>
    <div className="signal-list" aria-busy={loading}>
      {events.map(event => <button key={event.id} type="button" onClick={click => onSelect(event, click.currentTarget)}>
        <span>{sourceLabel(event).toUpperCase()} · {dateLabel(event).toUpperCase()}</span>
        <strong>{event.title}</strong><span className="signal-list-arrow" aria-hidden="true">↗</span>
      </button>)}
    </div>
    <div className="source-feed-footer">
      {loading && <p role="status">{events.length ? "Loading more sources…" : "Loading sources…"}</p>}
      {page?.error && <p role="status">{events.length ? "More sources could not load." : "Sources could not load."}</p>}
      {(archive || more || events.length > 0) && <button type="button" className="source-feed-more" aria-disabled={loading || (!more && !page?.error)} onClick={() => {
        if (loading || (!more && !page?.error)) return;
        if (archive) {
          const cursor = page?.error ? page.requestedCursor : page?.nextCursor ?? null;
          setPage(previous => ({ events: previous?.events ?? [], nextCursor: previous?.nextCursor ?? null,
            requestedCursor: cursor, loading: true, error: false }));
          void fetchPage(cursor).then(next => receivePage(next, cursor)).catch(() => failPage(cursor));
        }
        else setSampleLimit(limit => limit + 20);
      }}>{loading ? "LOADING SOURCES…" : page?.error ? "RETRY SOURCES" : more ? "LOAD MORE SOURCES" : "ALL AVAILABLE SOURCES SHOWN"} {more && <span aria-hidden="true">↓</span>}</button>}
      {!loading && !page?.error && !more && <p role="status">{events.length ? snapshot ? "You’ve reached the end of this saved sample." : "You’re caught up with the available sources for this point." : archive ? "No readable sources for this point yet." : "No sources in this sample."}</p>}
    </div>
  </section>;
}
