"use client";

import {sourceHasDayPrecision} from "@/lib/data/source-presentation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {pointPath} from "@/lib/seo/paths";
import {trackEvent} from "@/lib/analytics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopicSourceFeed from "@/components/TopicSourceFeed";
import ConnectionEvidence from "@/components/ConnectionEvidence";
import { connectionsFor, threadCounts, threadOrigin } from "@/lib/data/exploration";
import SourceText from "@/components/SourceText";
import StoryReading from "@/components/StoryReading";
import AskSymtri from "@/components/AskSymtri";
import type { AskResult } from "@/lib/ai/ask";
import { getTopic, seedCatalog } from "@/lib/universe";
import type { RelatedSignal, SignalEvent, SignalFeed, SnapshotDay } from "@/lib/data/model";
import { regionActivity, regionRelationships } from "@/lib/data/activity";
import { selectDistinctHeadlines, selectFocusedSignals } from "@/lib/data/select";

const Universe = dynamic(() => import("@/components/universe/Universe"), { ssr: false, loading: () => <div className="universe-loading">AWAKENING THE MAP</div> });

type DisplaySignal = { id: string; title: string; source: string; publishedAt: string; dateOnly:boolean; age: string; summary: string; url?: string; live: boolean };
const emptySignals: SignalEvent[] = [];
function restoreControlFocus(control:HTMLElement|null,fallback:HTMLElement|null) {
  requestAnimationFrame(()=>{
    const target=control?.isConnected && control.getClientRects().length ? control : fallback;
    target?.focus();
  });
}
function ageOf(publishedAt: string, referenceAt: string) {
  const minutes = Math.max(0, Math.floor((Date.parse(referenceAt) - Date.parse(publishedAt)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} hour${hours === 1 ? "" : "s"} ago` : `${Math.floor(hours / 24)} day${hours < 48 ? "" : "s"} ago`;
}
function sourceName(source: string, url: string, sourceLabels: Record<string, string>) {
  if (sourceLabels[source]) return sourceLabels[source];
  if (source.startsWith("feed-")) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { /* Retain the source ID. */ }
  }
  return source;
}
function showLive(event: Pick<SignalEvent, "id" | "title" | "source" | "publishedAt" | "summary" | "url">, observedAt: string, sourceLabels: Record<string, string>): DisplaySignal {
  return { id: event.id, title: event.title, source: sourceName(event.source, event.url, sourceLabels), publishedAt: event.publishedAt,dateOnly:sourceHasDayPrecision(event.source),
    age: sourceHasDayPrecision(event.source) ? shortDay(event.publishedAt.slice(0, 10)) : ageOf(event.publishedAt, observedAt),
    summary: event.summary, url: event.url, live: true };
}
function shortDay(day: string) { return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase(); }

export default function Experience() {
  const [entered, setEntered] = useState(false);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [topicRetry, setTopicRetry] = useState(0);
  const [childId, setChildId] = useState<string | null>(null);
  const [signalId, setSignalId] = useState<string | null>(null);
  const [connectedSignal, setConnectedSignal] = useState<DisplaySignal | null>(null);
  const [nearbyResult, setNearbyResult] = useState<{ id: string; signals: RelatedSignal[] } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [liveFeed, setLiveFeed] = useState<SignalFeed | null>(null);
  const [feedError, setFeedError] = useState(false);
  const [feedRetry, setFeedRetry] = useState(0);
  const [topicArchive, setTopicArchive] = useState<{ key: string; events: SignalEvent[]; error: boolean } | null>(null);
  const unavailableStories = useRef(new Set<string>());
  const [hiddenStoryIds, setHiddenStoryIds] = useState<Set<string>>(() => new Set());
  const [childPage, setChildPage] = useState(0);
  const [copiedPoint, setCopiedPoint] = useState<string | null>(null);
  const deepLinkApplied = useRef(false);
  const historicalLink = useRef<{day:string;signal:string|null;connection:string|null}|null>(null);
  const [historyDays, setHistoryDays] = useState<SnapshotDay[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [pendingDay, setPendingDay] = useState<string | null>(null);
  const [historicalFeed, setHistoricalFeed] = useState<{ day: string; feed: SignalFeed } | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [askInitial,setAskInitial]=useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [mobileGuideOpen, setMobileGuideOpen] = useState(false);
  const [mobileRegionPage, setMobileRegionPage] = useState(0);
  const [mapSearch, setMapSearch] = useState("");
  const askOpener=useRef<HTMLElement|null>(null);
  const askTrigger = useRef<HTMLButtonElement>(null);
  const mobileGuideTrigger = useRef<HTMLButtonElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const detailPanel = useRef<HTMLElement>(null);
  const storyReturn = useRef<{ key: string; scrollTop: number; control: HTMLButtonElement } | null>(null);
  const lastFocusLocation = useRef<string | null>(null);
  const [askSteps, setAskSteps] = useState<AskResult["pathSteps"]>([]);
  const askPath = useMemo(() => askSteps.map((step) => step.regionId).filter((id, index, ids) => index === 0 || id !== ids[index - 1]), [askSteps]);
  const displayFeed = selectedDay && historicalFeed?.day === selectedDay ? historicalFeed.feed : liveFeed;
  const catalog = displayFeed?.catalog ?? seedCatalog;
  const topics = catalog.topics;
  const sourceLabels = catalog.sourceLabels;
  const counts = useMemo(() => threadCounts(displayFeed), [displayFeed]);
  const countPeriod = selectedDay ? "IN SNAPSHOT" : displayFeed?.publishedEvidence ? "READABLE · 14 DAYS" : displayFeed?.childCounts ? "IN 14 DAYS" : "IN VIEW";
  const ageReference = selectedDay && displayFeed ? displayFeed.observedAt : now;
  const feedProvenance = displayFeed?.scope === "archive" ? "ARCHIVED OBSERVATIONS" : displayFeed?.partial ? "PARTIAL OBSERVATIONS" : "CURRENT OBSERVATIONS";
  const measuredActivity = useMemo(() => displayFeed ? displayFeed.activity ?? regionActivity(displayFeed.events, Date.parse(displayFeed.observedAt), catalog) : null, [displayFeed, catalog]);
  const measuredRelationships = useMemo(() => displayFeed ? displayFeed.relationships ?? regionRelationships(displayFeed.events, Date.parse(displayFeed.observedAt), catalog) : null, [displayFeed, catalog]);
  const leadingRegion = measuredActivity && topics.length ? topics.reduce((leader, topic) => (measuredActivity[topic.id]?.score ?? 0) > (measuredActivity[leader.id]?.score ?? 0) ? topic : leader, topics[0]) : null;
  const leadingRegionActivity = leadingRegion ? measuredActivity?.[leadingRegion.id] : null;
  const rankedRegions = useMemo(() => [...topics].sort((a, b) => (measuredActivity?.[b.id]?.score ?? 0) - (measuredActivity?.[a.id]?.score ?? 0)), [topics, measuredActivity]);
  const shownMobileRegionPage = Math.min(mobileRegionPage, Math.max(0, Math.ceil((rankedRegions.length - 3) / 12) - 1));
  const mobileLatest = useMemo(() => {
    const recent = [...(displayFeed?.events ?? [])].filter((event) => event.topics.length > 0)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const firstBySource = new Map<string, SignalEvent>();
    for (const event of recent) if (!firstBySource.has(event.source)) firstBySource.set(event.source, event);
    return selectDistinctHeadlines([...firstBySource.values(), ...recent], 4)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }, [displayFeed]);
  const overviewCatalog = useMemo(() => {
    const ranked = [...catalog.topics].sort((a, b) => (measuredActivity?.[b.id]?.score ?? 0) - (measuredActivity?.[a.id]?.score ?? 0));
    const ids = new Set(ranked.slice(0, 12).map((topic) => topic.id));
    if (focusedId) ids.add(focusedId);
    if (connectionId) ids.add(connectionId);
    for (const id of askPath) ids.add(id);
    return { ...catalog, topics: catalog.topics.filter((topic) => ids.has(topic.id)),
      topicEdges: catalog.topicEdges.filter(([a, b]) => ids.has(a) && ids.has(b)) };
  }, [catalog, measuredActivity, focusedId, connectionId, askPath]);
  const searchCandidates = useMemo(() => topics.flatMap((topic) => [
    { id: topic.id, childId: null as string | null, name: topic.name, region: topic.short },
    ...topic.children.map((child) => ({ id: topic.id, childId: child.id, name: child.name, region: topic.short })),
  ]), [topics]);
  const searchMatches = useMemo(() => mapSearch.trim().length >= 2
    ? searchCandidates.filter((item) => item.name.toLowerCase().includes(mapSearch.trim().toLowerCase())).slice(0, 6)
    : [], [mapSearch, searchCandidates]);
  const selectSearchMatch = () => {
    const match = searchMatches[0];
    if (!match) return;
    chooseTopic(match.id);
    setChildId(match.childId);
    setMapSearch("");
  };
  const searchKeys = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); selectSearchMatch(); }
    if (event.key === "Escape" && mapSearch) { event.stopPropagation(); setMapSearch(""); }
  };
  const archiveRelationships = selectedDay ? null : liveFeed?.knowledgeGraph?.relationships ?? null;
  const focus = getTopic(focusedId, catalog);
  const shownChildPage = focus ? Math.min(childPage, Math.max(0, Math.ceil(focus.children.length / 24) - 1)) : 0;
  const hover = getTopic(hoveredId, catalog);
  const focusActivity = focus && measuredActivity?.[focus.id];
  const hoverActivity = hover && measuredActivity?.[hover.id];
  const relatedRegions = focus ? connectionsFor(focus.id, displayFeed, catalog) : [];
  const connection = relatedRegions.find((item) => item.topic.id === connectionId);
  const rankedChildren = focus ? [...focus.children].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.name.localeCompare(b.name)) : [];
  const child = focus?.children.find((item) => item.id === childId);
  const topicKey = focus ? `${focus.id}:${childId ?? ""}` : null;
  const sharePointId = child?.id ?? focus?.id ?? null;
  const topicLoading = !selectedDay && topicArchive?.key !== topicKey;
  const archiveForFocus = !selectedDay && topicArchive?.key === topicKey ? topicArchive.events : emptySignals;
  const focusedSignals = focus && displayFeed ? selectFocusedSignals(displayFeed.events, archiveForFocus, focus.id) : emptySignals;
  const childSignals = child && selectedDay && displayFeed
    ? displayFeed.events.filter((event) => event.topics.some((match) => match.subtopicId === child.id)) : emptySignals;
  const liveForChild = child ? (selectedDay ? childSignals : focusedSignals.filter((event) => event.topics.some((match) => match.subtopicId === child.id))).slice(0, 3) : [];
  const regionSignals = focus && displayFeed ? focusedSignals.slice(0, 3).map((event) => showLive(event, ageReference, sourceLabels)) : [];
  const visibleSignals: DisplaySignal[] = child
    ? liveForChild.length ? liveForChild.map((event) => showLive(event, ageReference, sourceLabels)) : []
    : regionSignals;
  const historicalSignal = selectedDay && displayFeed?.events.find(item => item.id === signalId);
  const signal = (historicalSignal ? showLive(historicalSignal, ageReference, sourceLabels) : null) ?? visibleSignals.find((item) => item.id === signalId) ?? (connectedSignal?.id === signalId ? { ...connectedSignal, age: connectedSignal.dateOnly ? shortDay(connectedSignal.publishedAt.slice(0,10)) : ageOf(connectedSignal.publishedAt, ageReference) } : null);
  const nearbySignals = nearbyResult?.id === signalId ? nearbyResult.signals : [];
  const signalMarkers = connectedSignal?.id === signalId && !visibleSignals.some((item) => item.id === signalId)
    ? [...visibleSignals, connectedSignal] : visibleSignals;
  const chooseTopic = (id: string | null) => { setConnectionId(null); setFocusedId(id); setHoveredId(null); setChildId(null); setSignalId(null); setAskSteps([]); setChildPage(0); setMobileGuideOpen(false); setMobileRegionPage(0); };
  const followNearby = (item: RelatedSignal) => {
    setConnectionId(null);
    const match = item.topics.find((candidate) => getTopic(candidate.topicId, catalog));
    if (!match) return;
    setConnectedSignal(showLive(item, new Date().toISOString(), sourceLabels));
    setFocusedId(match.topicId);
    setChildId(match.subtopicId);
    setHoveredId(null);
    setSignalId(item.id);
    setAskSteps([]);
    setMobileGuideOpen(false);
  };
  const followAnswer = (result: AskResult) => {
    // A late answer must not pull someone away from a location they chose while waiting.
    if (lastFocusLocation.current !== `${entered}:${focusedId}:${childId}:${signalId}:${connectionId}`) return;
    setConnectionId(null);setAskSteps(result.pathSteps);setHoveredId(null);
    if(result.sourceSignalId && result.sourceSignalId===signalId) return;
    setFocusedId(result.regionIds[0] ?? null);setChildId(result.subtopicId);setSignalId(null);
  };
  const hideUnavailableStory = useCallback((id: string) => {
    unavailableStories.current.add(id);
    setHiddenStoryIds(current => new Set([...current, id]));
    setSignalId(current => current === id ? null : current);
    setConnectedSignal(current => current?.id === id ? null : current);
    setLiveFeed(current => current ? { ...current, events: current.events.filter(event => event.id !== id) } : current);
    setTopicArchive(current => current ? { ...current, events: current.events.filter(event => event.id !== id) } : current);
    setNearbyResult(current => current ? { ...current, signals: current.signals.filter(event => event.id !== id) } : current);
  }, []);
  const openFeedStory = (event: SignalEvent, control: HTMLButtonElement) => {
    storyReturn.current = { key: `${topicKey}:${selectedDay ?? "now"}`, scrollTop: detailPanel.current?.scrollTop ?? 0, control };
    setConnectedSignal(showLive(event, ageReference, sourceLabels));
    setSignalId(event.id);
  };
  const goBack = () => {
    if (connectionId) setConnectionId(null);
    else if (signalId) {
      setSignalId(null);
    } else if (childId) setChildId(null);
    else chooseTopic(null);
  };
  const returnToNow = () => { setPendingDay(null); setSelectedDay(null); setSignalId(null); setHistoryError(false); setAskOpen(false); setAskSteps([]); setMobileGuideOpen(false); };

  useEffect(() => {
    if (!signalId || selectedDay || connectedSignal?.id === signalId) return;
    const controller = new AbortController();
    fetch(`/api/signal?id=${encodeURIComponent(signalId)}`, {cache:"no-store", signal:controller.signal})
      .then(response => response.ok ? response.json() : null).then(result => {
        if (result?.event && !controller.signal.aborted) setConnectedSignal(showLive(result.event, new Date().toISOString(), sourceLabels));
      }).catch(() => {});
    return () => controller.abort();
  }, [signalId, selectedDay, connectedSignal?.id, sourceLabels]);
  useEffect(() => {if(focusedId)trackEvent("select_region",{id:focusedId});},[focusedId]);
  useEffect(() => {if(childId)trackEvent("select_topic",{id:childId});},[childId]);
  useEffect(() => {if(askOpen)trackEvent("ask_symtri_open");},[askOpen]);
  const copyPointLink = async () => {
    if (!sharePointId) return;
    const path = !connectionId && !signalId && !selectedDay ? pointPath(sharePointId,catalog) ?? "/" : "/";
    const url = new URL(path, window.location.origin);
    if (path === "/") url.searchParams.set("point", sharePointId);
    if (connectionId) url.searchParams.set("connection", connectionId);
    if (signalId) url.searchParams.set("signal", signalId);
    if (selectedDay) url.searchParams.set("day", selectedDay);
    const channel = typeof navigator.share === "function" ? "native" : "clipboard";
    url.searchParams.set("utm_source", "share"); url.searchParams.set("utm_medium", "referral");
    try { if (typeof navigator.share === "function") await navigator.share({title: `${child?.name ?? focus?.name} | SYMTRI`, url: url.toString()}); else await navigator.clipboard.writeText(url.toString()); trackEvent("share", {point: sharePointId, channel}); setCopiedPoint(sharePointId); }
    catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setCopiedPoint("error"); }
  };

  useEffect(() => {
    const location = `${entered}:${focusedId}:${childId}:${signalId}:${connectionId}`;
    if (location === lastFocusLocation.current) return;
    lastFocusLocation.current = location;
    if (!entered || askOpen) return;
    const saved = storyReturn.current;
    if (!signalId && !connectionId && saved?.key === `${topicKey}:${selectedDay ?? "now"}` && detailPanel.current) {
      detailPanel.current.scrollTop = saved.scrollTop;
      storyReturn.current = null;
      if (saved.control.isConnected) {
        saved.control.focus({ preventScroll: true });
        return;
      }
    }
    if (signalId || connectionId) detailPanel.current?.scrollTo({ top: 0 });
    const target = focusedId ? panelHeading.current : document.querySelector<HTMLButtonElement>(".brand");
    target?.focus({ preventScroll: true });
  }, [entered, focusedId, childId, signalId, connectionId, askOpen, topicKey, selectedDay]);

  useEffect(() => {
    if (!entered || !deepLinkApplied.current) return;
    const url = new URL(window.location.href);
    if (sharePointId) url.searchParams.set("point", sharePointId);
    else url.searchParams.delete("point");
    for (const [key, value] of [["connection", connectionId], ["signal", signalId], ["day", selectedDay]]) { if (value) url.searchParams.set(key!, value); else url.searchParams.delete(key!); }
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
  }, [entered, sharePointId, selectedDay, signalId, connectionId]);

  useEffect(() => {
    const restoreLocation = () => {
      const requested = new URL(window.location.href).searchParams.get("point");
      let resolved = requested ?? "";
      for (let step = 0; step < 8 && catalog.redirects?.[resolved]; step++) resolved = catalog.redirects[resolved];
      const topic = catalog.topics.find(item => item.id === resolved || item.children.some(child => child.id === resolved));
      setFocusedId(topic?.id ?? null);
      setChildId(topic?.children.find(child => child.id === resolved)?.id ?? null);
      const params = new URL(window.location.href).searchParams;
      const signal = params.get("signal"); const connection = params.get("connection"); const day = params.get("day");
      setSignalId(signal && /^[\w:.-]{1,200}$/.test(signal) ? signal : null);
      setConnectionId(connection && catalog.topics.some(item => item.id === connection) && connection !== topic?.id ? connection : null);
      const validDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
      historicalLink.current = validDay ? {day:validDay,signal,connection} : null;
      setPendingDay(validDay); setSelectedDay(validDay);
      setHoveredId(null);
      setAskSteps([]);
      setMobileGuideOpen(false);
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [catalog]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") {
      if (askOpen) { setAskOpen(false); setAskSteps([]); restoreControlFocus(askOpener.current,askTrigger.current); return; }
      if (mobileGuideOpen) { setMobileGuideOpen(false); mobileGuideTrigger.current?.focus(); return; }
      setConnectionId(null); setSignalId(null); setChildId(null); setFocusedId(null); setAskSteps([]);
    } };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [askOpen, mobileGuideOpen]);
  useEffect(() => {
    if (!entered && !new URLSearchParams(window.location.search).has("point")) return;
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/signals", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) }).then(async (response) => {
        if (!response.ok) throw new Error("Signal feed unavailable");
        const feed: SignalFeed = await response.json();
        if (!Array.isArray(feed.events)) throw new Error("Invalid signal feed");
        if (!controller.signal.aborted) {
          // A fresh published overview can confirm that a removed story is ready again.
          for (const event of feed.events) unavailableStories.current.delete(event.id);
          setHiddenStoryIds(current => {
            const published = new Set(feed.events.map(event => event.id));
            const remaining = new Set([...current].filter(id => !published.has(id)));
            return remaining.size === current.size ? current : remaining;
          });
          if (!deepLinkApplied.current) {
            deepLinkApplied.current = true;
            const requested = new URL(window.location.href).searchParams.get("point");
            if (requested && /^[a-z0-9][a-z0-9-]{1,80}$/.test(requested)) {
              const linkedCatalog = feed.catalog ?? seedCatalog;
              let resolved = requested;
              for (let step = 0; step < 8 && linkedCatalog.redirects?.[resolved]; step++) resolved = linkedCatalog.redirects[resolved];
              const matched = linkedCatalog.topics.find((topic) => topic.id === resolved || topic.children.some((item) => item.id === resolved));
              if (matched) {
                setEntered(true);
                setFocusedId(matched.id);
                setChildId(matched.children.find((item) => item.id === resolved)?.id ?? null);
                const params = new URL(window.location.href).searchParams;
                const signal = params.get("signal"); const connection = params.get("connection"); const day = params.get("day");
                if (signal && /^[\w:.-]{1,200}$/.test(signal)) setSignalId(signal);
                if (connection && linkedCatalog.topics.some(item => item.id === connection) && connection !== matched.id) setConnectionId(connection);
                if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {historicalLink.current={day,signal,connection};setPendingDay(day);setSelectedDay(day);}
              }
            }
          }
          setLiveFeed(feed); setFeedError(false);
        }
      }).catch(() => { if (!controller.signal.aborted) setFeedError(true); });
    };
    load();
    const timer = window.setInterval(load, 15 * 60 * 1000);
    document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [entered, feedRetry]);
  useEffect(() => {
    if (!entered) return;
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/history", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) }).then(async (response) => {
        if (!response.ok) return;
        const index: { days: SnapshotDay[] } = await response.json();
        if (Array.isArray(index.days)) setHistoryDays(index.days);
      }).catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 15 * 60 * 1000);
    document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [entered]);
  useEffect(() => {
    if (!pendingDay) return;
    const controller = new AbortController();
    fetch(`/api/history?day=${encodeURIComponent(pendingDay)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) }).then(async (response) => {
      if (!response.ok) throw new Error("Snapshot unavailable");
      const feed: SignalFeed = await response.json();
      if (!Array.isArray(feed.events)) throw new Error("Invalid snapshot");
      if (controller.signal.aborted) return;
      const restored = historicalLink.current?.day === pendingDay ? historicalLink.current : null;
      historicalLink.current = null;
      setHistoricalFeed({ day: pendingDay, feed });
      setSelectedDay(pendingDay);
      setConnectionId(restored?.connection ?? null);
      setPendingDay(null);
      setSignalId(restored?.signal ?? null);
      setAskOpen(false);
      setAskSteps([]);
      setHistoryError(false);
    }).catch(() => { if (!controller.signal.aborted) { setPendingDay(null); setHistoryError(true); } });
    return () => controller.abort();
  }, [pendingDay]);
  useEffect(() => {
    if (!entered || !focusedId || selectedDay || !liveFeed) return;
    const controller = new AbortController();
    const key = `${focusedId}:${childId ?? ""}`;
    const params = new URLSearchParams({ regionId: focusedId });
    if (childId) params.set("childId", childId);
    fetch(`/api/topic?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) }).then(async (response) => {
      if (!response.ok) throw new Error("Topic sources unavailable");
      const result: { events: SignalEvent[] } = await response.json();
      if (!Array.isArray(result.events)) throw new Error("Invalid topic sources");
      if (!controller.signal.aborted) setTopicArchive({ key, events: result.events.filter(event => !unavailableStories.current.has(event.id)), error: false });
    }).catch(() => { if (!controller.signal.aborted) setTopicArchive({ key, events: [], error: true }); });
    return () => controller.abort();
  }, [entered, focusedId, childId, selectedDay, liveFeed, topicRetry]);
  useEffect(() => {
    if (!signalId || selectedDay || !entered) return;
    const controller = new AbortController();
    fetch(`/api/related?id=${encodeURIComponent(signalId)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) })
      .then(async (response) => {
        if (!response.ok) return;
        const result: { signals: RelatedSignal[] } = await response.json();
        if (!controller.signal.aborted && Array.isArray(result.signals)) setNearbyResult({ id: signalId, signals: result.signals.filter(event => !unavailableStories.current.has(event.id)) });
      }).catch(() => {});
    return () => controller.abort();
  }, [entered, selectedDay, signalId]);

  return <main className={`experience ${entered ? "experience--entered" : ""}`}>
    <Universe readableRelationships={selectedDay ? regionRelationships(displayFeed?.events ?? []) : displayFeed?.publishedEvidence?.archiveRelationships} catalog={overviewCatalog} entered={entered} askOpen={askOpen} focusedId={focusedId} selectedChildId={childId} selectedSignalId={signalId} hoveredId={hoveredId} signalMarkers={signalMarkers.map((item) => ({ id: item.id, source: item.source }))} regionActivity={measuredActivity} childCounts={counts} countsReady={Boolean(displayFeed)} countPeriod={countPeriod} connectedRegionId={connectionId} onConnection={(from, to) => { if (!connectionsFor(from,displayFeed,catalog).some(link=>link.topic.id===to && (link.availableRecent>0 || link.availableArchive>0))) return; chooseTopic(from); setConnectionId(to); }} regionRelationships={measuredRelationships} archiveRelationships={archiveRelationships} semanticRelationships={displayFeed?.semanticRelationships ?? null} askPathIds={askPath} askSteps={askSteps} onFocus={chooseTopic} onChild={(id) => { setConnectionId(null); setChildId(id); setSignalId(null); }} onSignal={setSignalId} onHover={setHoveredId} reducedMotion={reducedMotion} />
    <div className="grain" aria-hidden="true" />
    <div className="edge-vignette" aria-hidden="true" />

    <section className="entrance" aria-label="Welcome to Symtri" aria-hidden={entered} inert={entered}>
      <div className="entrance-top"><span className="wordmark">SYMTRI<span className="wordmark-dot">.</span></span><span className="entrance-edition">AN ATLAS OF COLLECTIVE ATTENTION</span></div>
      <div className="entrance-center">
        <div className="symbol" aria-hidden="true"><i /><i /><i /><b /></div>
        <p className="eyebrow">A LIVING MAP OF IDEAS</p>
        <h1>THE INTERNET<br /><em>IS THINKING.</em></h1>
        <p className="intro-copy">A place to see what technology is becoming.<br />Follow the signals. Find the connections.</p>
        <button className="enter-button" onClick={() => {trackEvent("enter_universe"); setEntered(true);}}><span>ENTER THE UNIVERSE</span><span className="enter-arrow">↗</span></button><Link className="entrance-about" href="/about">About SYMTRI ↗</Link>
      </div>
      <div className="entrance-bottom"><span>{topics.length} REGIONS · {topics.reduce((count, topic) => count + topic.children.length, 0)} TOPICS · LIVE SOURCES</span><a href="https://github.com/stanleycyang/symtri" target="_blank" rel="noopener noreferrer">OPEN SOURCE · CONTRIBUTE ON GITHUB ↗</a></div>
    </section>

    <div className="universe-ui" aria-hidden={!entered} inert={!entered}>
      <header className="topbar"><button className="brand" onClick={() => chooseTopic(null)} aria-label="Return to universe">SYMTRI<span>.</span></button><div className="topbar-center" role="status"><span className={`live-pulse ${feedError && !selectedDay ? "live-pulse--error" : ""}`} /> {selectedDay ? `${displayFeed?.partial ? "PARTIAL HISTORY" : "HISTORY"} · ${shortDay(selectedDay)}` : feedError ? liveFeed ? "SOURCE FEED DELAYED" : "SOURCE FEED UNAVAILABLE" : liveFeed ? liveFeed.scope === "archive" ? "ARCHIVED STORIES" : liveFeed.partial ? "PARTIAL LIVE FEED" : "LIVE STORIES" : "CONNECTING TO SOURCES"} <span className="topbar-separator">/</span> {displayFeed?.scope === "rolling" ? "PAST 14 DAYS" : displayFeed ? "OBSERVED ACTIVITY" : feedError ? "EXPLORE THE MAP" : "ACTIVITY LOADING"}</div>{selectedDay && <button type="button" className="mobile-history-status" onClick={returnToNow}>{shortDay(selectedDay)} <span>NOW ↗</span></button>}<div className="topbar-actions"><Link className="github-link" href="/about">ABOUT ↗</Link><a className="github-link" href="https://github.com/stanleycyang/symtri" target="_blank" rel="noopener noreferrer" aria-label="View and contribute to SYMTRI on GitHub">GITHUB ↗</a>{feedError && !selectedDay && <button type="button" className="feed-retry" onClick={() => { setFeedError(false); setFeedRetry((attempt) => attempt + 1); }}>RETRY FEED</button>}<button ref={askTrigger} type="button" className="ask-trigger" aria-expanded={askOpen} onClick={() => { if(!askOpen){askOpener.current=askTrigger.current;setAskInitial("");} setAskOpen((open) => !open); setMobileGuideOpen(false); if (askOpen) setAskSteps([]); }}>ASK SYMTRI <span>↗</span></button></div></header>
      {entered && <AskSymtri open={askOpen} signalId={signal?.live ? signal.id : undefined} initialQuestion={askInitial} key={selectedDay ?? "now"} day={selectedDay} subject={signal?.title ?? child?.name ?? focus?.name} sourceLabels={sourceLabels} onClose={() => { setAskInitial("");setAskOpen(false); setAskSteps([]); restoreControlFocus(askOpener.current,askTrigger.current); }} onResult={followAnswer} onNavigate={(id, subtopicId) => { setConnectionId(null); setFocusedId(id); setChildId(subtopicId); setSignalId(null); setHoveredId(null); }} />}
      {!focus && <div className="scene-heading"><p className="eyebrow">{displayFeed ? feedProvenance : "EXPLORE THE SIGNAL"}</p><h2>A map of what matters.</h2><p>Ideas gather. Connections form. Attention moves.</p>{feedError && !selectedDay && !liveFeed && <p className="feed-error-copy">Live observations could not load. Explore the map or retry the feed.</p>}{displayFeed?.archiveCount ? <p className="archive-total">{displayFeed.archiveCount.toLocaleString()} UNIQUE SIGNALS OBSERVED {selectedDay ? "BY THIS SNAPSHOT" : "SINCE LAUNCH"}</p> : null}{!selectedDay && liveFeed?.lastIngestedAt ? <div className="feed-freshness">LAST INGEST · {ageOf(liveFeed.lastIngestedAt, now).toUpperCase()}</div> : null}{leadingRegion && leadingRegionActivity && leadingRegionActivity.count > 0 && <button type="button" className="scene-leader" onClick={() => chooseTopic(leadingRegion.id)}><span>{displayFeed?.activity ? "MOST ACTIVE · PAST 14 DAYS" : "MOST ACTIVE IN CURRENT OBSERVATIONS"}</span><strong>{leadingRegion.name}</strong><b aria-hidden="true">↗</b></button>}</div>}
      <nav className="breadcrumbs" aria-label="Current location"><button onClick={() => chooseTopic(null)}>UNIVERSE</button>{focus && <><span>/</span><button onClick={() => { setConnectionId(null); setChildId(null); setSignalId(null); }}>{focus.short}</button></>}{child && <><span>/</span><span>{child.name.toUpperCase()}</span></>}{connection && <><span>/</span><span>{connection.topic.short}</span></>}</nav>

      {hover && !focus && <div className="hover-card" aria-live="polite"><span className="hover-card-label">REGION IN FOCUS · {hoverActivity ? feedProvenance : "AWAITING OBSERVATIONS"}</span><strong>{hover.name}</strong><span><b>{hoverActivity ? hoverActivity.momentum.toUpperCase() : "PENDING"}</b> activity <i /> {hoverActivity ? hoverActivity.count : 0} signals</span></div>}
      {focus && <aside ref={detailPanel} key={`${topicKey}:${selectedDay ?? "now"}`} className="detail-panel">
        <div className="panel-top"><span className="eyebrow">{connection ? "CONNECTION / SHARED SOURCES" : signal ? "SIGNAL / SOURCE" : child ? topicLoading && !liveForChild.length ? "TOPIC / CHECKING SOURCES" : liveForChild.length ? selectedDay ? "TOPIC / HISTORICAL SIGNALS" : "TOPIC / LIVE SIGNALS" : selectedDay ? "TOPIC / NO HISTORICAL SIGNALS" : "TOPIC / NO OBSERVED SIGNALS" : "REGION / ACTIVE TOPICS"}</span><div className="panel-actions">{<button type="button" className="share-point" onClick={() => void copyPointLink()} aria-label={`Copy link to ${child?.name ?? focus.name}`}>{copiedPoint === sharePointId ? "COPIED" : copiedPoint === "error" ? "COPY FAILED" : "SHARE"}</button>}<button className="icon-button" onClick={goBack} aria-label="Go back">↗</button></div></div>
        <h3 ref={panelHeading} tabIndex={-1}>{connection ? `${focus.short} × ${connection.topic.short}` : signal ? signal.title : child ? child.name : focus.name}</h3>
        {signal?.live && signal.url && <a className="mobile-read-source" onClick={() => trackEvent("outbound_source", {sourceId: signal.source})} href={signal.url} target="_blank" rel="noopener noreferrer">READ SOURCE <span aria-hidden="true">↗</span></a>}
        {!connection && !signal && (child ? <p className="panel-description">{liveForChild.length ? `${selectedDay ? "Observed then" : "Recent observations"} about ${child.name.toLowerCase()}.` : selectedDay ? `No source for ${child.name.toLowerCase()} appears in the ${shortDay(selectedDay)} snapshot.` : topicArchive?.key !== topicKey ? "Looking for matching sources…" : topicArchive.error ? "Matching sources could not load. Retry to check this thread." : `No matching sources ${displayFeed?.childCounts ? "in the past 14 days" : "in this source sample"}. ${threadOrigin(child.id)}`}</p> : <><p className="panel-description">{focusActivity ? focusedSignals.length ? `Recent research, code, and conversation matched to ${focus.name.toLowerCase()}${selectedDay ? ` on ${shortDay(selectedDay)}` : ""}.` : `No source for ${focus.name.toLowerCase()} appears ${selectedDay ? `in the ${shortDay(selectedDay)} snapshot` : "in the current view"}. ${selectedDay ? "Explore another date or region." : "Browse the archive or explore its topics."}` : focus.description}</p><div className="activity-readout"><span>{focusActivity ? displayFeed?.partial ? feedProvenance : "OBSERVED · PAST 14 DAYS" : "AWAITING OBSERVATIONS"}</span><strong>{focusActivity ? focusActivity.momentum.toUpperCase() : "PENDING"}</strong><span>{focusActivity ? focusActivity.count : 0} SIGNALS</span></div></>)}
        <TopicSourceFeed key={`${topicKey}:${selectedDay ?? "now"}`} regionId={focus.id} childId={child?.id ?? null}
          hidden={Boolean(connection || signal)} archive={!selectedDay && Boolean(liveFeed && (liveFeed.scope === "rolling" || liveFeed.scope === "archive"))}
          snapshot={Boolean(selectedDay)} initialEvents={child ? (selectedDay ? childSignals : focusedSignals.filter(event => event.topics.some(match => match.subtopicId === child.id))) : focusedSignals}
          unavailableIds={hiddenStoryIds} sourceLabel={event => sourceName(event.source, event.url, sourceLabels)}
          dateLabel={event => showLive(event, ageReference, sourceLabels).age} onSelect={openFeedStory} />
        {connection ? <ConnectionEvidence key={`${focus.id}:${connection.topic.id}:${selectedDay ?? "now"}`} from={focus} to={connection.topic} recent={connection.availableRecent} archived={connection.availableArchive} seeded={connection.seeded} observedEvents={displayFeed?.events ?? emptySignals} snapshot={selectedDay ? displayFeed?.events ?? emptySignals : null} sourceLabels={sourceLabels} onExplore={() => chooseTopic(connection.topic.id)} /> : signal ? <div className="signal-detail">{signal.live && !selectedDay ? <StoryReading key={signal.id} id={signal.id} summary={signal.summary} onUnavailable={hideUnavailableStory} onAsk={question=>{askOpener.current=document.activeElement as HTMLElement;setAskInitial(question);setAskOpen(true);}} /> : <SourceText text={signal.summary}/>}<div className="signal-meta"><span>{signal.source}</span><span>{signal.age}</span></div>{signal.live && signal.url ? <a className="read-source" onClick={() => trackEvent("outbound_source", {sourceId: signal.source})} href={signal.url} target="_blank" rel="noopener noreferrer">READ SOURCE <span>↗</span></a> : <span className="mock-notice">SOURCE UNAVAILABLE</span>}{!selectedDay && nearbySignals.length > 0 && <div className="nearby-signals"><span>NEARBY IDEAS IN THE ARCHIVE</span>{nearbySignals.map((item) => <button key={item.id} type="button" onClick={() => followNearby(item)}><small>{(sourceLabels[item.source] ?? item.source).toUpperCase()} · {getTopic(item.topics[0]?.topicId, catalog)?.short.toUpperCase() ?? "TECHNOLOGY"}</small><strong>{item.title}</strong><b aria-hidden="true">↗</b></button>)}</div>}</div> : child ? <>{!liveForChild.length ? <div className="thread-empty" role="status">{!selectedDay && topicArchive?.key === topicKey && topicArchive.error ? <button type="button" className="connection-action" onClick={() => { setTopicArchive(null); setTopicRetry((value) => value + 1); }}>Retry sources</button> : <p>{selectedDay ? "The saved snapshot is a sample of observations." : topicArchive?.key !== topicKey ? "Checking the archive for this thread." : "The map keeps a place for this subject as coverage grows."}</p>}{rankedChildren.filter((item) => item.id !== child.id && (counts[item.id] ?? 0) > 0).slice(0, 3).map((item) => <button type="button" key={item.id} onClick={() => { setChildId(item.id); setSignalId(null); }}>{item.name}<small>{counts[item.id]} {countPeriod.toLowerCase()}</small><b>↗</b></button>)}</div> : null}</> : <><div className="connection-guide"><h4>How connections work</h4><p>Short lines group threads within a region. Curved lines connect regions; their brightness reflects shared-source activity and subject similarity. Moving particles mark recent shared sources. Select a connection to read its evidence.</p></div>{relatedRegions.length > 0 && <div className="related-regions"><span>EXPLORE CONNECTIONS</span><div>{relatedRegions.map(({ topic, availableRecent: recent, availableArchive: archived, seeded }) => <button disabled={!recent && !archived} key={topic.id} onClick={() => setConnectionId(topic.id)}><strong>{topic.name}</strong><small>{recent ? `${recent} readable · ${selectedDay ? "saved sample" : "14 days"}` : archived ? `${archived} readable · archive` : seeded ? "Conceptual route · no readable sources" : "No readable sources"}</small><b>↗</b></button>)}</div></div>}<div className="panel-section-title">FOLLOW A THREAD <span>{focus.children.length.toString().padStart(2, "0")}</span></div><div className="topic-list">{rankedChildren.slice(shownChildPage * 24, shownChildPage * 24 + 24).map((item) => <button key={item.id} onClick={() => { setChildId(item.id); setSignalId(null); }}><span>{item.name}</span><small>{displayFeed ? counts[item.id] ?? 0 : "…"} {displayFeed ? (counts[item.id] ?? 0) === 0 ? "QUIET · " + countPeriod : countPeriod : "LOADING"}</small><b>↗</b></button>)}</div>{focus.children.length > 24 && <div className="thread-pages"><button type="button" disabled={shownChildPage === 0} onClick={() => setChildPage(shownChildPage - 1)}>PREVIOUS</button><span>{shownChildPage + 1} / {Math.ceil(focus.children.length / 24)}</span><button type="button" disabled={(shownChildPage + 1) * 24 >= focus.children.length} onClick={() => setChildPage(shownChildPage + 1)}>NEXT</button></div>}</>}
      </aside>}
      {historyDays.length > 1 && <div className={`history-timeline ${focus ? "history-timeline--focused" : ""}`} role="group" aria-label="Explore historical snapshots" aria-busy={Boolean(pendingDay)}>
        <span className="history-caption" role="status">{pendingDay ? `LOADING ${shortDay(pendingDay)}` : historyError ? "ARCHIVE UNAVAILABLE" : selectedDay ? `VIEWING ${shortDay(selectedDay)}` : "MOVE THROUGH TIME"}</span>
        <div className="history-track">
          <span>{shortDay(historyDays[historyDays.length - 1].day)}</span>
          {[...historyDays].reverse().map((item) => <button key={item.day} type="button" title={`${shortDay(item.day)} · ${item.archiveCount ? `${item.archiveCount} unique signals observed` : `${item.eventCount} observed signals`}`} aria-label={`View ${shortDay(item.day)} snapshot${item.archiveCount ? ` with ${item.archiveCount} unique signals observed` : ""}`} aria-pressed={selectedDay === item.day} className={selectedDay === item.day ? "history-day history-day--active" : "history-day"} onClick={() => { setPendingDay(item.day); setHistoryError(false); }} />)}
          <button type="button" className={`history-now ${selectedDay ? "" : "history-now--active"}`} aria-pressed={!selectedDay} onClick={returnToNow}>NOW</button>
        </div>
      </div>}
      {!focus && <div className="explore-strip"><span className="explore-index">01 — {String(overviewCatalog.topics.length).padStart(2, "0")}</span><span>CHOOSE A REGION TO FOLLOW ITS SIGNALS</span><div className="region-dots">{overviewCatalog.topics.map((topic) => <button key={topic.id} type="button" aria-label={`Explore ${topic.name}`} title={topic.name} style={{ background: topic.color }} onClick={() => chooseTopic(topic.id)} />)}</div><select className="mobile-region-select" aria-label="Choose a region" value="" onChange={(event) => chooseTopic(event.target.value)}><option value="" disabled>CHOOSE A REGION</option>{overviewCatalog.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></div>}
      {!focus && !askOpen && <div className="map-search"><label htmlFor="map-point-search">FIND A POINT</label><input id="map-point-search" value={mapSearch} onKeyDown={searchKeys} onChange={(event) => setMapSearch(event.target.value)} placeholder="Search the growing map…" autoComplete="off" />{mapSearch.trim().length >= 2 && !searchMatches.length && <p className="map-search-empty" role="status">No map point found. Try another subject or Ask Symtri.</p>}{searchMatches.length > 0 && <div className="map-search-results">{searchMatches.map((item) => <button key={item.childId ?? item.id} type="button" onClick={() => { chooseTopic(item.id); setChildId(item.childId); setMapSearch(""); }}>{item.name}<small>{item.region}</small></button>)}</div>}</div>}
      {!focus && !askOpen && <section className={`mobile-guide ${mobileGuideOpen ? "mobile-guide--open" : ""}`} aria-label="Discover the universe">
        <div className="mobile-guide-peek">
          <button ref={mobileGuideTrigger} className="mobile-guide-toggle" type="button" aria-expanded={mobileGuideOpen} onClick={() => setMobileGuideOpen((open) => !open)}>
            <span>{selectedDay ? `FIELD GUIDE · ${shortDay(selectedDay)}` : "FIELD GUIDE · NOW"}</span>
            <strong>{leadingRegion && leadingRegionActivity?.count ? leadingRegion.name : "Explore the living map"}</strong>
            <small>{mobileLatest[0] ? mobileLatest[0].title : displayFeed ? "Choose a region to follow its signals." : "Connecting to live sources…"}</small>
            <b>{mobileGuideOpen ? "CLOSE ↑" : "EXPLORE REGIONS ↓"}</b>
          </button>
          <button className="mobile-guide-ask" type="button" onClick={() => { setMobileGuideOpen(false); askOpener.current=askTrigger.current;setAskInitial("");setAskOpen(true); }}>ASK<br />SYMTRI <span>↗</span></button>
        </div>
          <div className="mobile-guide-shortcuts" aria-label="Explore leading regions">{rankedRegions.slice(0, 3).map((topic) => <button key={topic.id} type="button" onClick={() => chooseTopic(topic.id)}><span className="mobile-guide-region-dot" style={{ background: topic.color }} /><strong>{topic.short}</strong><small>{measuredActivity?.[topic.id]?.count ?? 0} seen</small></button>)}</div>
        {mobileGuideOpen && <div className="mobile-guide-content" id="mobile-guide-content">
          <div className="mobile-guide-search"><label htmlFor="mobile-map-search">Find a subject or region</label><input id="mobile-map-search" type="search" value={mapSearch} onKeyDown={searchKeys} onChange={(event) => setMapSearch(event.target.value)} placeholder="Try fusion, robotics, security…" autoComplete="off" />{mapSearch.trim().length >= 2 && !searchMatches.length && <p className="map-search-empty" role="status">No map point found. Try another subject or Ask Symtri.</p>}{searchMatches.length > 0 && <div className="mobile-guide-search-results">{searchMatches.map((item) => <button key={item.childId ?? item.id} type="button" onClick={() => { chooseTopic(item.id); setChildId(item.childId); setMapSearch(""); }}>{item.name}<small>{item.region}</small></button>)}</div>}</div>
          {historyDays.length > 1 && <div className="mobile-guide-time"><h3>Through time</h3><div>{[...historyDays].reverse().map((item) => <button key={item.day} type="button" aria-pressed={selectedDay === item.day} onClick={() => { setPendingDay(item.day); setMobileGuideOpen(false); }}>{shortDay(item.day)}</button>)}<button type="button" aria-pressed={!selectedDay} onClick={returnToNow}>NOW</button></div></div>}

          <div className="mobile-guide-stories"><h3>From the sources</h3>{mobileLatest.length ? mobileLatest.map((event) => <button key={event.id} type="button" onClick={() => followNearby(event)}><span>{(sourceLabels[event.source] ?? event.source).toUpperCase()} · {sourceHasDayPrecision(event.source) ? shortDay(event.publishedAt.slice(0, 10)) : ageOf(event.publishedAt, ageReference).toUpperCase()}</span><strong>{event.title}</strong><b aria-hidden="true">↗</b></button>) : <p>Fresh signals will appear here as the sources connect.</p>}</div>
          <div className="mobile-guide-regions"><h3>More regions</h3><div>{rankedRegions.slice(3 + shownMobileRegionPage * 12, 3 + (shownMobileRegionPage + 1) * 12).map((topic) => <button key={topic.id} type="button" onClick={() => chooseTopic(topic.id)}><span className="mobile-guide-region-dot" style={{ background: topic.color }} /><strong>{topic.name}</strong><small>{measuredActivity?.[topic.id]?.count ?? 0} {displayFeed?.activity ? "signals" : "observed"}</small></button>)}</div>{rankedRegions.length > 15 && <div className="thread-pages"><button type="button" disabled={shownMobileRegionPage === 0} onClick={() => setMobileRegionPage(shownMobileRegionPage - 1)}>PREVIOUS</button><span>{shownMobileRegionPage + 1} / {Math.ceil((rankedRegions.length - 3) / 12)}</span><button type="button" disabled={3 + (shownMobileRegionPage + 1) * 12 >= rankedRegions.length} onClick={() => setMobileRegionPage(shownMobileRegionPage + 1)}>NEXT</button></div>}</div>
        </div>}
      </section>}
      <div className="controls-hint">DRAG TO ORBIT <span>·</span> SCROLL TO ZOOM <span>·</span> CLICK TO EXPLORE</div>
      <div className="side-coordinate">SYMTRI / FIELD NOTES / 001</div>
    </div>
  </main>;
}
