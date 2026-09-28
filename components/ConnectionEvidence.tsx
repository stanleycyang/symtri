"use client";

import { useEffect, useState } from "react";
import type { SignalEvent } from "@/lib/data/model";
import type { Topic } from "@/lib/universe";

export default function ConnectionEvidence({ from, to, recent, archived, seeded, snapshot, observedEvents, sourceLabels, onExplore }: {
  from: Topic; to: Topic; recent: number; archived: number; seeded: boolean;
  snapshot: SignalEvent[] | null; observedEvents: SignalEvent[]; sourceLabels: Record<string, string>; onExplore: () => void;
}) {
  const [archive, setArchive] = useState(false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ events: SignalEvent[]; error: boolean } | null>(null);
  useEffect(() => {
    if (snapshot) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ from: from.id, to: to.id });
    if (archive) params.set("archive", "1");
    fetch(`/api/connections?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Connection unavailable");
      const data = await response.json() as { events: SignalEvent[] };
      if (!Array.isArray(data.events)) throw new Error("Invalid connection");
      if (!controller.signal.aborted) setResult({ events: data.events, error: false });
    }).catch(() => { if (!controller.signal.aborted) setResult({ events: [], error: true }); });
    return () => controller.abort();
  }, [from.id, to.id, snapshot, archive, retry]);
  const shared = (event: SignalEvent) => [from.id, to.id].every((id) => event.topics.some((match) => match.topicId === id));
  const events = snapshot ? snapshot.filter(shared).slice(0, 20)
    : [...(result?.events ?? []), ...observedEvents.filter(shared)].filter((event, index, all) => all.findIndex((item) => item.id === event.id) === index).slice(0, 20);
  return <section className="connection-evidence" aria-label={`Why ${from.name} connects to ${to.name}`}>
    <p className="panel-description">A shared signal is one source matched to both regions. It shows a common subject, rather than a claim that one caused the other.</p>
    <div className="connection-count"><strong>{recent}</strong><span>shared signals {snapshot ? "in this snapshot’s 14-day window" : "in the past 14 days"}</span></div>
    {seeded && <p className="connection-note">This route is part of the starting map. It remains visible even when there are no recent shared sources.</p>}
    {!snapshot && archived > 0 && <p className="connection-note">{archived} shared signals recorded since launch.</p>}
    <h4>{snapshot ? "Sources saved in this snapshot" : archive ? "Latest shared sources in the archive" : "Sources behind the connection"}</h4>
    {!snapshot && !result && <p role="status">Loading shared sources…</p>}
    {!snapshot && result?.error && <p role="status">Shared sources could not load. <button type="button" onClick={() => { setResult(null); setRetry((value) => value + 1); }}>Retry sources</button></p>}
    {(snapshot || result && !result.error) && !events.length && <p className="connection-note">{snapshot ? "No shared source is included in this snapshot’s saved sample." : archive ? "No shared source is available from the connected sources." : "No shared source matches this pair in the recent window."}</p>}
    <div className="connection-sources">{events.map((event) => <a key={event.id} href={event.url} target="_blank" rel="noopener noreferrer"><small>{sourceLabels[event.source] ?? event.source} · {event.publishedAt.slice(0, 10)}</small><strong>{event.title}</strong><span>{event.summary}</span><b>Read source ↗</b></a>)}</div>
    {!snapshot && <button type="button" className="connection-action" onClick={() => { setResult(null); setArchive((value) => !value); }}>{archive ? "Show recent sources" : "Look through earlier sources"}</button>}
    <button type="button" className="connection-action" onClick={onExplore}>Explore {to.name} ↗</button>
  </section>;
}
