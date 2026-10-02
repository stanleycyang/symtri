"use client";

import { useEffect, useRef, useState } from "react";
import type { AskResult } from "@/lib/ai/ask";
import {sourceHasDayPrecision,sourceKindLabels} from "@/lib/data/source-presentation";

type Props = {
  day: string | null;
  initialQuestion?: string;
  subject?: string;
  signalId?: string;
  sourceLabels: Record<string, string>;
  onClose: () => void;
  onResult: (result: AskResult) => void;
  onNavigate: (regionId: string, subtopicId: string | null) => void;
};

function sourceTime(publishedAt: string, observedAt: string, historical: boolean, dateOnly: boolean): string {
  const published = Date.parse(publishedAt);
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(published) || !Number.isFinite(observed)) return "DATE UNKNOWN";
  const minutes = Math.max(0, Math.floor((observed - published) / 60_000));
  if (historical || dateOnly || minutes >= 14 * 24 * 60) {
    return new Date(published).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase();
  }
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes} MIN AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "HOUR" : "HOURS"} AGO`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "DAY" : "DAYS"} AGO`;
}

export default function AskSymtri({ day, subject, signalId, initialQuestion="", sourceLabels, onClose, onResult, onNavigate }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const sources = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState(initialQuestion);
  const [result, setResult] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { input.current?.focus(); return () => controller.current?.abort(); }, []);

  const ask = async (value: string, selected?:{signalId:string;subject:string}) => {
    const trimmed = value.trim();
    if (trimmed.length < 3 || busy) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setQuestion(trimmed);
    setBusy(true);
    setError("");
    const deadline = setTimeout(() => request.abort("timeout"), 40_000);
    try {
      const response = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ question: trimmed, ...(day ? { day } : {}),
          context: { ...(result && !result.needsClarification ? { question: (result.intent === "comparison"
            ? `Compare ${result.subjects?.join(" and ")}` : result.subjects?.length===1 ? `Explain ${result.subjects[0]}` : result.question).slice(0,240),answer:result.summary.slice(0,800) } : {}), ...((selected?.subject ?? subject) ? {subject:(selected?.subject ?? subject)?.slice(0,240)} : {}), ...((selected?.signalId ?? signalId ?? result?.sourceSignalId) ? {signalId:selected?.signalId ?? signalId ?? result?.sourceSignalId} : {}) } }), signal: request.signal,
      });
      if (response.status === 429) throw new Error("Ask is busy right now. Please try again after the limit resets.");
      if (!response.ok) throw new Error("Signals are unavailable right now. Try again shortly.");
      const answer: AskResult = await response.json();
      setResult(answer);
      onResult(answer);
    } catch (cause) {
      if (request.signal.reason === "timeout") setError("Following these sources took too long. Please try again.");
      else if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Signals are unavailable right now. Try again shortly.");
    } finally {
      clearTimeout(deadline);
      if (!request.signal.aborted || request.signal.reason === "timeout") setBusy(false);
    }
  };

  return <section className="ask-panel" aria-label="Ask Symtri">
    <div className="ask-panel-top"><span>ASK SYMTRI <i /> {day ? "HISTORICAL VIEW" : result?.scope === "knowledge" ? "KNOWLEDGE ARCHIVE" : "CURRENT SOURCES"}</span><button type="button" onClick={onClose} aria-label="Close Ask Symtri">×</button></div>
    <form onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
      <label htmlFor="symtri-question">Where should we look?</label>
      <div className="ask-input-row"><input ref={input} id="symtri-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What's happening with AI agents?" maxLength={240} /><button type="submit" disabled={busy || question.trim().length < 3} aria-label="Ask Symtri">↗</button></div>
    </form>
    {!result && !busy && <div className="ask-examples"><button type="button" onClick={() => void ask("What's happening with AI agents?")}>AI AGENTS ↗</button><button type="button" onClick={() => void ask("What connects nuclear energy and AI?")}>AI × ENERGY ↗</button></div>}
    {busy && <p className="ask-state">FOLLOWING THE SIGNALS…</p>}
    {error && <p className="ask-state ask-state--error" role="alert">{error}</p>}
    {result && <div className="ask-result" aria-live="polite">
      {(result.summaryKind === "model" || result.events.length > 0) && <div className="ask-summary-heading">
        {result.summaryKind === "model" && <span className="ask-summary-label">SOURCE SYNTHESIS</span>}
        {result.events.length > 0 && <button type="button" onClick={() => sources.current?.scrollIntoView({ block: "nearest" })} aria-label={`Show ${result.events.length} sources`}>{result.events.length} SOURCES ↓</button>}
      </div>}
      {result.claims?.length ? <div className="ask-claims">{result.claims.slice(0, 2).map((claim, index) => <p className="ask-summary" key={index}>{claim.text} {claim.evidence.map((item, evidenceIndex) => {
        const source = result.events.find((event) => event.id === item.sourceId);
        return source ? <a key={evidenceIndex} href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`Source: ${source.title}`}>[{result.events.indexOf(source) + 1}]</a> : null;
      })}</p>)}<details className="ask-evidence"><summary>Read supporting passages{result.claims.length > 2 ? " and more detail" : ""}</summary>{result.claims.map((claim, index) => <div key={index}>{index > 1 && <p className="ask-summary">{claim.text}</p>}{claim.evidence.map((item, evidenceIndex) => {
        const source = result.events.find((event) => event.id === item.sourceId);
        return <blockquote key={evidenceIndex}><p>{item.quote}</p>{source && <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>}</blockquote>;
      })}</div>)}</details></div> : <p className="ask-summary">{result.summary}</p>}
      {result.pathSteps.length > 0 && <><span className="ask-path-label">{result.regionIds.length > 1 ? "CONCEPTUAL MAP ROUTE" : "MAP LOCATION"}</span><div className="ask-path" aria-label="Highlighted map path">{result.pathSteps.map((step, index) => <span key={`${step.regionId}:${step.subtopicId ?? "region"}`}>{index > 0 && <b>↗</b>}<button type="button" onClick={() => onNavigate(step.regionId, step.subtopicId)}>{step.label.toUpperCase()}</button></span>)}</div></>}
      {result.events.length > 0 && <div className="ask-sources" ref={sources}><span>{result.scope === "knowledge" ? "FROM THE KNOWLEDGE ARCHIVE" : result.retrieval === "semantic-assisted" ? "RANKED BY MEANING" : "FROM CURRENT SOURCES"}</span>{result.events.map((event) => <a key={event.id} href={event.url} target="_blank" rel="noopener noreferrer"><small>{(sourceLabels[event.source] ?? event.source).toUpperCase()}{event.sourceKind ? ` · ${sourceKindLabels[event.sourceKind]}` : ""} · {sourceTime(event.publishedAt, result.observedAt, result.scope === "history", sourceHasDayPrecision(event.source))}{result.citedEventIds.includes(event.id) && " · CITED"}</small>{event.title}<b>↗</b></a>)}</div>}
      {result.followUps?.length ? <div className="ask-followups"><span>KEEP EXPLORING</span>{result.followUps.map(item=><button type="button" key={item.question} disabled={busy} onClick={()=>void ask(item.question,item)}>{item.label} ↗</button>)}</div> : null}
    </div>}
  </section>;
}
