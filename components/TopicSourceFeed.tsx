"use client";

import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { TopicSource, TopicSourcePage } from "@/lib/data/model";
import { INITIAL_TOPIC_PAGE_SIZE, NEXT_TOPIC_PAGE_SIZE } from "@/lib/data/topic-pagination";
import { canPrefetchTopic, topicFeedCache, topicRevisionScope, type TopicFeedSnapshot } from "@/lib/data/topic-feed-cache";
const VirtualSourceList = lazy(() => import("./VirtualSourceList"));
type Page = TopicFeedSnapshot & { requestedCursor: string | null; loading: boolean; error: boolean };

export default function TopicSourceFeed({ regionId, childId, hidden, archive, snapshot, initialEvents, unavailableIds, sourceLabel, dateLabel, onSelect, onSources, scopeRevision }: {
  regionId: string; childId: string | null; hidden: boolean; archive: boolean; snapshot: boolean; scopeRevision: string;
  initialEvents: TopicSource[]; unavailableIds: Set<string>;
  sourceLabel: (event: TopicSource) => string; dateLabel: (event: TopicSource) => string;
  onSelect: (event: TopicSource, control: HTMLButtonElement) => void;
  onSources: (events: TopicSource[], error: boolean) => void;
}) {
  const cacheKey = `${regionId}:${childId ?? ""}:${scopeRevision}`;
  const [page, setPage] = useState<Page | null>(() => {
    const saved = archive ? topicFeedCache.read(cacheKey) : null;
    return saved ? { ...saved, requestedCursor: null, loading: false, error: false } : null;
  });
  const [updatedPage, setUpdatedPage] = useState<TopicSourcePage | null>(null);
  const [sampleLimit, setSampleLimit] = useState(INITIAL_TOPIC_PAGE_SIZE);
  const [focusedId, setFocusedId] = useState<string | null>(page?.anchor?.kind === "footer" ? null : page?.anchor?.id ?? null);
  const [listHasFocus, setListHasFocus] = useState(false);
  const section = useRef<HTMLElement>(null);
  const moreControl = useRef<HTMLButtonElement>(null);
  const latestPage = useRef(page);
  const latestSources = useRef(onSources);
  const initialPage = useRef(page);
  const lastScroll = useRef(page?.scrollTop ?? 0);
  const lastAnchor = useRef(page?.anchor);
  const measurementReader = useRef<(() => VirtualItem[]) | null>(null);
  const lastMeasurements = useRef(page?.measurements);
  const registerMeasurements = useCallback((reader: (() => VirtualItem[]) | null) => { measurementReader.current = reader; },[]);
  const mounted = useRef(false);
  const latestCacheKey = useRef(cacheKey);
  const requestedScope = useRef<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const urlFor = useCallback((cursor: string | null) => {
    const params = new URLSearchParams({ regionId, browse: "1", view: "list" });
    if (childId) params.set("childId",childId);
    if (cursor) params.set("cursor",cursor);
    return `/api/topic?${params}`;
  }, [regionId,childId]);
  useEffect(() => { latestSources.current = onSources; }, [onSources]);
  useEffect(() => { latestCacheKey.current = cacheKey; }, [cacheKey]);
  useEffect(() => {
    latestPage.current = page;
    if (archive && page && !page.loading && !page.error) topicFeedCache.save(cacheKey,{ ...page,scrollTop: lastScroll.current,anchor: lastAnchor.current,measurements: lastMeasurements.current });
  }, [archive,cacheKey,page]);
  useEffect(() => {
    mounted.current = true;
    const saved = initialPage.current;
    const panel = section.current?.closest<HTMLElement>(".detail-panel");
    if (saved && panel) {
      panel.scrollTop = saved.scrollTop;
      latestSources.current(saved.firstPage.events,false);
      if (saved.anchor) requestAnimationFrame(() => requestAnimationFrame(() => {
        const row = saved.anchor!.kind === "footer" ? section.current?.querySelector<HTMLElement>(".source-feed-footer") : section.current?.querySelector<HTMLButtonElement>(`[data-source-id="${CSS.escape(saved.anchor!.id)}"]`);
        if (row) panel.scrollTop += row.getBoundingClientRect().top-panel.getBoundingClientRect().top-saved.anchor!.offset;
      }));
    }
    const rememberScroll = () => {
      if (!panel || !section.current || section.current.hidden) return;
      const current = readSourcePosition(panel,section.current);
      lastScroll.current = current.scrollTop; lastAnchor.current = current.anchor;
    };
    panel?.addEventListener("scroll",rememberScroll,{passive:true});
    return () => {
      mounted.current = false;
      panel?.removeEventListener("scroll",rememberScroll);
      const current = latestPage.current;
      if (archive && current && !current.error) topicFeedCache.save(latestCacheKey.current,{ ...current,scrollTop: lastScroll.current,anchor: lastAnchor.current,measurements: lastMeasurements.current });
    };
  }, [archive]);
  useLayoutEffect(() => {
    const element = section.current;
    const panel = element?.closest<HTMLElement>(".detail-panel");
    return () => {
      if (!archive || !element || !panel || element.hidden) return;
      const position = readSourcePosition(panel,element);
      lastScroll.current = position.scrollTop; lastAnchor.current = position.anchor;
      lastMeasurements.current = measurementReader.current?.() ?? lastMeasurements.current;
      const current = latestPage.current;
      if (current && !current.error) topicFeedCache.save(latestCacheKey.current,{...current,...position,measurements: lastMeasurements.current});
    };
  }, [archive]);
  useEffect(() => {
    if (!archive) return;
    if (refresh === 0 && requestedScope.current !== null && requestedScope.current !== scopeRevision && topicRevisionScope(latestPage.current?.revision ?? "") === scopeRevision) {
      requestedScope.current = scopeRevision;
      return;
    }
    requestedScope.current = scopeRevision;
    let active = true;
    void topicFeedCache.request(urlFor(null),true).then(next => {
      if (!active) return;
      const current = latestPage.current;
      setRefreshing(false); setRefreshError(false);
      if (refresh > 0) { setUpdatedPage(null); lastScroll.current = 0; lastAnchor.current = undefined; lastMeasurements.current = undefined; }
      const unchanged = current && current.firstPage.events.length===next.events.length && current.firstPage.events.every((event,index) => event.id===next.events[index].id && event.title===next.events[index].title);
      if (current && refresh === 0 && (current.revision !== next.revision || !unchanged)) {
        setUpdatedPage(next);
      } else {
        setPage(current && refresh === 0 ? { ...current,revision: next.revision } : { ...next,firstPage: next,scrollTop: 0,requestedCursor: null,loading: false,error: false });
        latestSources.current(current && refresh === 0 ? current.firstPage.events : next.events,false);
        if (refresh > 0) requestAnimationFrame(() => section.current?.querySelector<HTMLButtonElement>("[data-source-id]")?.focus({preventScroll:true}));
      }
    }).catch(() => {
      if (!active) return;
      setRefreshing(false);
      if (refresh > 0) setRefreshError(true);
      setPage(previous => previous ? { ...previous,loading: false,error: !previous.events.length } : { events: [],nextCursor: null,revision: "",firstPage: { events: [],nextCursor: null,revision: "" },scrollTop: 0,requestedCursor: null,loading: false,error: true });
      if (!latestPage.current?.events.length) latestSources.current([],true);
    });
    return () => { active = false; };
  }, [archive,urlFor,refresh,scopeRevision]);

  useEffect(() => {
    const control = moreControl.current;
    if (!archive || hidden || !page?.nextCursor || page.loading || !control) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (!canPrefetchTopic(connection)) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      if (!canPrefetchTopic(connection)) return;
      void topicFeedCache.request(urlFor(page.nextCursor)).catch(() => {});
    }, { root: section.current?.closest(".detail-panel"), rootMargin: "500px" });
    observer.observe(control);
    return () => observer.disconnect();
  }, [archive,hidden,page?.nextCursor,page?.loading,urlFor]);

  const focusSource = (id?: string) => {
    if (!id) return;
    setFocusedId(id);
    requestAnimationFrame(() => requestAnimationFrame(() => section.current?.querySelector<HTMLButtonElement>(`[data-source-id="${CSS.escape(id)}"]`)?.focus()));
  };
  const loadMore = (focusNew = false) => {
    if (!archive) {
      setSampleLimit(limit => limit+NEXT_TOPIC_PAGE_SIZE);
      if (focusNew) focusSource(initialEvents[sampleLimit]?.id);
      return;
    }
    const current = latestPage.current;
    const cursor = current?.error ? current.requestedCursor : current?.nextCursor ?? null;
    if (!current || current.loading || !cursor && !current.error) return;
    setPage({ ...current,requestedCursor: cursor,loading: true,error: false });
    void topicFeedCache.request(urlFor(cursor),Boolean(current.error)).then(next => {
      if (!mounted.current) return;
      if (focusNew) focusSource(next.events.find(event => !unavailableIds.has(event.id) && !current.events.some(previous => previous.id===event.id))?.id);
      setPage(previous => previous ? { ...previous,events: [...new Map([...previous.events,...next.events].map(event => [event.id,event])).values()],nextCursor: next.nextCursor,loading: false,error: false } : previous);
      if (!cursor) {
        setPage({ ...next,firstPage: next,scrollTop: 0,requestedCursor: null,loading: false,error: false });
        latestSources.current(next.events,false);
      } else if (next.revision !== current.revision) setUpdatedPage(next);
    }).catch(() => {
      if (mounted.current) setPage(previous => previous ? { ...previous,loading: false,error: true } : previous);
    });
  };
  const sourceEvents = archive && page ? page.events : initialEvents;
  const paginated = Boolean(archive && page);
  const events = useMemo(() => (paginated ? sourceEvents : sourceEvents.slice(0,sampleLimit)).filter(event => !unavailableIds.has(event.id)), [paginated,sourceEvents,sampleLimit,unavailableIds]);
  const more = archive ? Boolean(page?.nextCursor) : sampleLimit < initialEvents.length;
  const loading = archive && (!page || page.loading);
  const select = (event: TopicSource, control: HTMLButtonElement) => {
    const element = section.current;
    const panel = element?.closest<HTMLElement>(".detail-panel");
    if (panel && element) {
      const position = readSourcePosition(panel,element);
      lastScroll.current = position.scrollTop; lastAnchor.current = position.anchor;
    }
    lastMeasurements.current = measurementReader.current?.() ?? lastMeasurements.current;
    setFocusedId(event.id); onSelect(event,control);
  };
  const listProps = { events,sourceLabel,dateLabel,onFocus: setFocusedId,onSelect: select,loading };
  const plainList = <PlainSourceList {...listProps}/>;
  return <section ref={section} onFocusCapture={event => setListHasFocus(event.target instanceof HTMLElement && Boolean(event.target.closest("[data-source-id]")))} onBlurCapture={event => { if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) setListHasFocus(false); }} className="topic-source-feed" aria-label="Sources for this point" hidden={hidden} inert={hidden}>
    <div className="panel-section-title"><span>{snapshot ? "SOURCES IN THIS SNAPSHOT" : "LATEST READABLE SOURCES"}</span><span>{events.length} SHOWN</span></div>
    <p className="source-feed-scope">{snapshot ? "Browse the saved sample from this date." : archive ? "Newest first. Keep exploring to reach earlier sources in the archive." : "Sources in the current sample."}</p>
    {(updatedPage || refreshing) && <button type="button" className="source-feed-refresh" aria-disabled={refreshing} onClick={() => {
      if (refreshing) return;
      setRefreshing(true); setRefreshError(false);
      setPage(previous => previous ? { ...previous,loading: true } : previous);
      setRefresh(value => value+1);
      section.current?.closest<HTMLElement>(".detail-panel")?.scrollTo({ top: 0 });
    }}>{refreshing ? "REFRESHING SOURCES…" : "SOURCES UPDATED · REFRESH ↻"}</button>}
    {refreshError && <p role="status">Refresh could not load. Your existing sources are still here.</p>}
    {events.length > 100 ? <SourceListBoundary fallback={plainList}><Suspense fallback={plainList}><VirtualSourceList events={events} hidden={hidden} focusedId={focusedId} restoreFocus={listHasFocus} initialOffset={page?.scrollTop ?? 0} measurements={page?.measurements} onMeasurements={registerMeasurements} sourceLabel={sourceLabel} dateLabel={dateLabel} onFocus={setFocusedId} onSelect={select}/></Suspense></SourceListBoundary> : plainList}
    <div className="source-feed-footer">
      {loading && <p role="status">{events.length ? "Loading more sources…" : "Loading sources…"}</p>}
      {page?.error && <p role="status">{events.length ? "More sources could not load." : "Sources could not load."}</p>}
      {(archive || more || events.length>0) && <button ref={moreControl} type="button" className="source-feed-more" aria-disabled={loading || (!more && !page?.error)} onClick={event => { if (!loading && (more || page?.error)) loadMore(event.detail===0); }}>
        {loading ? "LOADING SOURCES…" : page?.error ? "RETRY SOURCES" : more ? "LOAD MORE SOURCES" : "ALL AVAILABLE SOURCES SHOWN"} {more && <span aria-hidden="true">↓</span>}
      </button>}
      {!loading && !page?.error && !more && <p role="status">{events.length ? snapshot ? "You’ve reached the end of this saved sample." : "You’re caught up with the available sources for this point." : archive ? "No readable sources for this point yet." : "No sources in this sample."}</p>}
    </div>
  </section>;
}

function PlainSourceList({events,sourceLabel,dateLabel,onFocus,onSelect,loading}: {
  events: TopicSource[]; sourceLabel: (event: TopicSource) => string; dateLabel: (event: TopicSource) => string;
  onFocus: (id: string) => void; onSelect: (event: TopicSource,control: HTMLButtonElement) => void; loading: boolean;
}) {
  return <div className="signal-list" role="list" aria-busy={loading}>{events.map((event,index) => <div key={event.id} role="listitem" aria-posinset={index+1} aria-setsize={events.length}>
    <button type="button" data-source-id={event.id} onFocus={() => onFocus(event.id)} onClick={click => onSelect(event,click.currentTarget)}>
      <span>{sourceLabel(event).toUpperCase()} · {dateLabel(event).toUpperCase()}</span><strong>{event.title}</strong><span className="signal-list-arrow" aria-hidden="true">↗</span>
    </button></div>)}</div>;
}

class SourceListBoundary extends Component<{ children: ReactNode; fallback: ReactNode },{ failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function readSourcePosition(panel: HTMLElement,section: HTMLElement): Pick<TopicFeedSnapshot,"scrollTop"|"anchor"> {
  const bounds = panel.getBoundingClientRect();
  const row = [...section.querySelectorAll<HTMLButtonElement>("[data-source-id]")]
    .find(button => button.getBoundingClientRect().bottom>bounds.top+panel.clientTop && button.getBoundingClientRect().top<bounds.bottom);
  if (row) return {scrollTop:panel.scrollTop,anchor:{id:row.dataset.sourceId!,offset:row.getBoundingClientRect().top-bounds.top,kind:"source"}};
  const footer = section.querySelector<HTMLElement>(".source-feed-footer");
  return {scrollTop:panel.scrollTop,anchor:footer?{id:"footer",offset:footer.getBoundingClientRect().top-bounds.top,kind:"footer"}:undefined};
}
