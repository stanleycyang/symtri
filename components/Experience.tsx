"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import AskSymtri from "@/components/AskSymtri";
import type { AskResult } from "@/lib/ai/ask";
import { getTopic, topics } from "@/lib/universe";
import type { SignalEvent, SignalFeed, SnapshotDay } from "@/lib/data/model";
import { regionActivity, regionRelationships, relationshipKey } from "@/lib/data/activity";

const Universe = dynamic(() => import("@/components/universe/Universe"), { ssr: false, loading: () => <div className="universe-loading">AWAKENING THE MAP</div> });

type DisplaySignal = { id: string; title: string; source: string; age: string; summary: string; url?: string; live: boolean };
const sourceLabels = { "hacker-news": "Hacker News", github: "GitHub", arxiv: "arXiv" } as const;
function ageOf(publishedAt: string, observedAt: string) {
  const hours = Math.max(0, Math.floor((Date.parse(observedAt) - new Date(publishedAt).getTime()) / 3600000));
  return hours < 1 ? "just now" : hours < 24 ? `${hours} hour${hours === 1 ? "" : "s"} ago` : `${Math.floor(hours / 24)} day${hours < 48 ? "" : "s"} ago`;
}
function showLive(event: SignalEvent, observedAt: string): DisplaySignal {
  return { id: event.id, title: event.title, source: sourceLabels[event.source], age: ageOf(event.publishedAt, observedAt), summary: event.summary, url: event.url, live: true };
}
function regionHighlights(events: SignalEvent[], regionId: string): SignalEvent[] {
  const matches = events.filter((event) => event.topics.some((match) => match.topicId === regionId && !match.subtopicId))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const chosen: SignalEvent[] = [];
  const sources = new Set<string>();
  for (const event of matches) if (!sources.has(event.source)) { chosen.push(event); sources.add(event.source); }
  for (const event of matches) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(event)) chosen.push(event);
  }
  return chosen.slice(0, 3).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
function shortDay(day: string) { return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase(); }

export default function Experience() {
  const [entered, setEntered] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [childId, setChildId] = useState<string | null>(null);
  const [signalId, setSignalId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [liveFeed, setLiveFeed] = useState<SignalFeed | null>(null);
  const [historyDays, setHistoryDays] = useState<SnapshotDay[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [pendingDay, setPendingDay] = useState<string | null>(null);
  const [historicalFeed, setHistoricalFeed] = useState<{ day: string; feed: SignalFeed } | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askSteps, setAskSteps] = useState<AskResult["pathSteps"]>([]);
  const askPath = askSteps.map((step) => step.regionId).filter((id, index, ids) => index === 0 || id !== ids[index - 1]);
  const displayFeed = selectedDay && historicalFeed?.day === selectedDay ? historicalFeed.feed : liveFeed;
  const sampleProvenance = displayFeed?.scope === "archive" ? "ARCHIVED SAMPLE" : displayFeed?.scope === "rolling" ? displayFeed.partial ? "PARTIAL ROLLING SAMPLE" : "ROLLING SAMPLE" : displayFeed?.partial ? "PARTIAL SAMPLE" : "OBSERVED SAMPLE";
  const measuredActivity = useMemo(() => displayFeed ? regionActivity(displayFeed.events, Date.parse(displayFeed.observedAt)) : null, [displayFeed]);
  const measuredRelationships = useMemo(() => displayFeed ? regionRelationships(displayFeed.events, Date.parse(displayFeed.observedAt)) : null, [displayFeed]);
  const focus = getTopic(focusedId);
  const hover = getTopic(hoveredId);
  const focusActivity = focus && measuredActivity?.[focus.id];
  const hoverActivity = hover && measuredActivity?.[hover.id];
  const relatedRegions = focus && measuredRelationships ? topics
    .filter((topic) => topic.id !== focus.id)
    .map((topic) => ({ topic, count: measuredRelationships[relationshipKey(focus.id, topic.id)] ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count).slice(0, 3) : [];
  const child = focus?.children.find((item) => item.id === childId);
  const liveForChild = child && displayFeed && (!selectedDay || historicalFeed?.day === selectedDay) ? displayFeed.events.filter((event) => event.topics.some((match) => match.subtopicId === child.id)).slice(0, 3) : [];
  const regionSignals = focus && displayFeed ? regionHighlights(displayFeed.events, focus.id).map((event) => showLive(event, displayFeed.observedAt)) : [];
  const visibleSignals: DisplaySignal[] = child
    ? liveForChild.length ? liveForChild.map((event) => showLive(event, displayFeed!.observedAt)) : selectedDay ? [] : child.events.map((event) => ({ ...event, live: false }))
    : regionSignals;
  const signal = visibleSignals.find((item) => item.id === signalId);
  const chooseTopic = (id: string | null) => { setFocusedId(id); setHoveredId(null); setChildId(null); setSignalId(null); setAskSteps([]); };
  const followAnswer = (result: AskResult) => { setAskSteps(result.pathSteps); setFocusedId(result.regionIds[0] ?? null); setChildId(result.subtopicId); setSignalId(null); setHoveredId(null); };
  const goBack = () => { if (signalId) setSignalId(null); else if (childId) setChildId(null); else chooseTopic(null); };

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setSignalId(null); setChildId(null); setFocusedId(null); setAskOpen(false); setAskSteps([]); } };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, []);
  useEffect(() => {
    if (!entered) return;
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/signals", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) return;
        const feed: SignalFeed = await response.json();
        if (Array.isArray(feed.events)) setLiveFeed(feed);
      }).catch(() => { /* Keep the last usable map if sources are unavailable. */ });
    };
    load();
    const timer = window.setInterval(load, 15 * 60 * 1000);
    document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [entered]);
  useEffect(() => {
    if (!entered) return;
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/history", { cache: "no-store", signal: controller.signal }).then(async (response) => {
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
    fetch(`/api/history?day=${encodeURIComponent(pendingDay)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Snapshot unavailable");
      const feed: SignalFeed = await response.json();
      if (!Array.isArray(feed.events)) throw new Error("Invalid snapshot");
      if (controller.signal.aborted) return;
      setHistoricalFeed({ day: pendingDay, feed });
      setSelectedDay(pendingDay);
      setPendingDay(null);
      setSignalId(null);
      setAskOpen(false);
      setAskSteps([]);
      setHistoryError(false);
    }).catch(() => { if (!controller.signal.aborted) { setPendingDay(null); setHistoryError(true); } });
    return () => controller.abort();
  }, [pendingDay]);

  return <main className={`experience ${entered ? "experience--entered" : ""}`}>
    <Universe entered={entered} askOpen={askOpen} allowSimulatedSignals={!selectedDay} focusedId={focusedId} selectedChildId={childId} selectedSignalId={signalId} hoveredId={hoveredId} signalMarkers={visibleSignals.map((item) => ({ id: item.id, source: item.source }))} regionActivity={measuredActivity} regionRelationships={measuredRelationships} semanticRelationships={displayFeed?.semanticRelationships ?? null} askPathIds={askPath} askSteps={askSteps} onFocus={chooseTopic} onChild={(id) => { setChildId(id); setSignalId(null); }} onSignal={setSignalId} onHover={setHoveredId} reducedMotion={reducedMotion} />
    <div className="grain" aria-hidden="true" />
    <div className="edge-vignette" aria-hidden="true" />

    <section className="entrance" aria-label="Welcome to Symtri" aria-hidden={entered}>
      <div className="entrance-top"><span className="wordmark">SYMTRI<span className="wordmark-dot">.</span></span><span className="entrance-edition">AN ATLAS OF COLLECTIVE ATTENTION</span></div>
      <div className="entrance-center">
        <div className="symbol" aria-hidden="true"><i /><i /><i /><b /></div>
        <p className="eyebrow">A LIVING MAP OF IDEAS</p>
        <h1>THE INTERNET<br /><em>IS THINKING.</em></h1>
        <p className="intro-copy">A place to see what technology is becoming.<br />Follow the signals. Find the connections.</p>
        <button className="enter-button" onClick={() => setEntered(true)}><span>ENTER THE UNIVERSE</span><span className="enter-arrow">↗</span></button>
      </div>
      <div className="entrance-bottom"><span>10 REGIONS · {topics.reduce((count, topic) => count + topic.children.length, 0)} TOPICS · LIVE SIMULATION</span><span>SCROLL TO EXPLORE AFTER ENTERING</span></div>
    </section>

    <div className="universe-ui" aria-hidden={!entered} inert={!entered}>
      <header className="topbar"><button className="brand" onClick={() => chooseTopic(null)} aria-label="Return to universe">SYMTRI<span>.</span></button><div className="topbar-center"><span className="live-pulse" /> {selectedDay ? `${displayFeed?.partial ? "PARTIAL HISTORY" : "HISTORY"} · ${shortDay(selectedDay)}` : liveFeed ? liveFeed.scope === "archive" ? "ARCHIVED STORIES" : liveFeed.partial ? "PARTIAL LIVE FEED" : "LIVE STORIES" : "SIMULATED UNIVERSE"} <span className="topbar-separator">/</span> {displayFeed?.scope === "rolling" ? "14-DAY SAMPLE" : displayFeed ? "SAMPLE ACTIVITY" : "ACTIVITY SIMULATED"}</div><button type="button" className="ask-trigger" aria-expanded={askOpen} onClick={() => { setAskOpen((open) => !open); if (askOpen) setAskSteps([]); }}>ASK SYMTRI <span>↗</span></button></header>
      {askOpen && <AskSymtri key={selectedDay ?? "now"} day={selectedDay} onClose={() => { setAskOpen(false); setAskSteps([]); }} onResult={followAnswer} onNavigate={(id, subtopicId) => { setFocusedId(id); setChildId(subtopicId); setSignalId(null); setHoveredId(null); }} />}
      {!focus && <div className="scene-heading"><p className="eyebrow">{displayFeed ? sampleProvenance : "EXPLORE THE SIGNAL"}</p><h2>A map of what matters.</h2><p>Ideas gather. Connections form. Attention moves.</p>{!selectedDay && liveFeed?.archiveCount ? <p className="archive-total">{liveFeed.archiveCount.toLocaleString()} UNIQUE SIGNALS OBSERVED SINCE LAUNCH</p> : null}</div>}
      <div className="breadcrumbs" aria-label="Current location"><button onClick={() => chooseTopic(null)}>UNIVERSE</button>{focus && <><span>/</span><button onClick={() => { setChildId(null); setSignalId(null); }}>{focus.short}</button></>}{child && <><span>/</span><span>{child.name.toUpperCase()}</span></>}</div>

      {hover && !focus && <div className="hover-card" aria-live="polite"><span className="hover-card-label">REGION IN FOCUS · {hoverActivity ? sampleProvenance : "SIMULATED ACTIVITY"}</span><strong>{hover.name}</strong><span><b>{hoverActivity ? hoverActivity.momentum.toUpperCase() : `↑ ${hover.change}%`}</b> activity <i /> {hoverActivity ? hoverActivity.count : hover.signals.toLocaleString()} signals</span></div>}
      {focus && <aside className="detail-panel">
        <div className="panel-top"><span className="eyebrow">{signal ? "SIGNAL / SOURCE" : child ? liveForChild.length ? selectedDay ? "TOPIC / HISTORICAL SIGNALS" : "TOPIC / LIVE SIGNALS" : selectedDay ? "TOPIC / NO HISTORICAL SIGNALS" : "TOPIC / SIMULATED SIGNALS" : "REGION / ACTIVE TOPICS"}</span><button className="icon-button" onClick={goBack} aria-label="Go back">↗</button></div>
        <h3>{signal ? signal.title : child ? child.name : focus.name}</h3>
        {signal ? <div className="signal-detail"><p>{signal.summary}</p><div className="signal-meta"><span>{signal.source}</span><span>{signal.age}</span></div>{signal.live && signal.url ? <a className="read-source" href={signal.url} target="_blank" rel="noopener noreferrer">READ SOURCE <span>↗</span></a> : <span className="mock-notice">SIMULATED SIGNAL · SOURCE LINK COMING WITH LIVE DATA</span>}</div> : child ? <><p className="panel-description">{liveForChild.length ? `${selectedDay ? "Observed then" : "Recent observations"} about ${child.name.toLowerCase()}.` : selectedDay ? `No sampled signals matched ${child.name.toLowerCase()} on ${shortDay(selectedDay)}.` : `Simulated signals gathering around ${child.name.toLowerCase()}.`}</p>{visibleSignals.length ? <div className="signal-list">{visibleSignals.map((item) => <button key={item.id} onClick={() => setSignalId(item.id)}><span>{item.source.toUpperCase()} · {item.age.toUpperCase()}</span><strong>{item.title}</strong><span className="signal-list-arrow">↗</span></button>)}</div> : <p className="history-empty" role="status">NO SIGNALS IN THIS SNAPSHOT</p>}</> : <><p className="panel-description">{focusActivity ? focusActivity.count ? `A sample of research, code, and conversation matched to ${focus.name.toLowerCase()}${selectedDay ? ` on ${shortDay(selectedDay)}` : " recently"}.` : `No sampled signals matched ${focus.name.toLowerCase()}${selectedDay ? ` on ${shortDay(selectedDay)}` : " recently"}.${selectedDay ? "" : " Explore its topics while the feed updates."}` : focus.description}</p><div className="activity-readout"><span>{focusActivity ? displayFeed?.partial ? sampleProvenance : "OBSERVED SAMPLE · PAST 14 DAYS" : "SIMULATED ACTIVITY"}</span><strong>{focusActivity ? focusActivity.momentum.toUpperCase() : `↑ ${focus.change}%`}</strong><span>{focusActivity ? focusActivity.count : focus.signals.toLocaleString()} SIGNALS</span></div>{relatedRegions.length > 0 && <div className="related-regions"><span>SHARED SIGNALS WITH</span><div>{relatedRegions.map(({ topic, count }) => <button key={topic.id} onClick={() => chooseTopic(topic.id)}>{topic.short} <small>{count}</small> ↗</button>)}</div></div>}{regionSignals.length > 0 && <><div className="panel-section-title">RECENT SIGNALS</div><div className="signal-list">{regionSignals.map((item) => <button key={item.id} onClick={() => setSignalId(item.id)}><span>{item.source.toUpperCase()} · {item.age.toUpperCase()}</span><strong>{item.title}</strong><span className="signal-list-arrow">↗</span></button>)}</div></>}<div className="panel-section-title">FOLLOW A THREAD <span>{focus.children.length.toString().padStart(2, "0")}</span></div><div className="topic-list">{focus.children.map((item) => <button key={item.id} onClick={() => { setChildId(item.id); setSignalId(null); }}><span>{item.name}</span><small>{displayFeed ? displayFeed.events.filter((event) => event.topics.some((match) => match.subtopicId === item.id)).length : item.signals} {displayFeed ? "SEEN" : "SIM."}</small><b>↗</b></button>)}</div></>}
      </aside>}
      {historyDays.length > 1 && <div className={`history-timeline ${focus ? "history-timeline--focused" : ""}`} role="group" aria-label="Explore historical snapshots" aria-busy={Boolean(pendingDay)}>
        <span className="history-caption" role="status">{pendingDay ? `LOADING ${shortDay(pendingDay)}` : historyError ? "ARCHIVE UNAVAILABLE" : selectedDay ? `VIEWING ${shortDay(selectedDay)}` : "MOVE THROUGH TIME"}</span>
        <div className="history-track">
          <span>{shortDay(historyDays[historyDays.length - 1].day)}</span>
          {[...historyDays].reverse().map((item) => <button key={item.day} type="button" title={`${shortDay(item.day)} · ${item.eventCount} sampled signals`} aria-label={`View ${shortDay(item.day)} snapshot`} aria-pressed={selectedDay === item.day} className={selectedDay === item.day ? "history-day history-day--active" : "history-day"} onClick={() => { setPendingDay(item.day); setHistoryError(false); }} />)}
          <button type="button" className={`history-now ${selectedDay ? "" : "history-now--active"}`} aria-pressed={!selectedDay} onClick={() => { setPendingDay(null); setSelectedDay(null); setSignalId(null); setHistoryError(false); setAskOpen(false); setAskSteps([]); }}>NOW</button>
        </div>
      </div>}
      {!focus && <div className="explore-strip"><span className="explore-index">01 — 10</span><span>CHOOSE A REGION TO FOLLOW ITS SIGNALS</span><div className="region-dots">{topics.map((topic) => <button key={topic.id} type="button" aria-label={`Explore ${topic.name}`} title={topic.name} style={{ background: topic.color }} onClick={() => chooseTopic(topic.id)} />)}</div><select className="mobile-region-select" aria-label="Choose a region" value="" onChange={(event) => chooseTopic(event.target.value)}><option value="" disabled>CHOOSE A REGION</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></div>}
      <div className="controls-hint">DRAG TO ORBIT <span>·</span> SCROLL TO ZOOM <span>·</span> CLICK TO EXPLORE</div>
      <div className="side-coordinate">SYMTRI / FIELD NOTES / 001</div>
    </div>
  </main>;
}
