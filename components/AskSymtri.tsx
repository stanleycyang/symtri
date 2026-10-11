"use client";

import { useEffect, useRef, useState } from "react";
import {readAskStream} from "@/lib/ai/ask-stream";
import type { AskResult } from "@/lib/ai/ask";
import {sourceHasDayPrecision,sourceKindLabels} from "@/lib/data/source-presentation";

type Props = {
  day: string | null;
  open: boolean;
  initialQuestion?: string;
  subject?: string;
  signalId?: string;
  sourceLabels: Record<string, string>;
  onClose: () => void;
  onResult: (result: AskResult) => void;
  onNavigate: (regionId: string, subtopicId: string | null) => void;
};

function focusAskControl(input: HTMLElement | null, panel: HTMLElement | null) {
  // Touch readers should see the answer instead of an automatically opened keyboard.
  const target = window.matchMedia("(pointer: fine)").matches ? input : panel;
  target?.focus({ preventScroll: true });
}

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

export default function AskSymtri({ open, day, subject, signalId, initialQuestion="", sourceLabels, onClose, onResult, onNavigate }: Props) {
  const panel = useRef<HTMLElement>(null);
  const answerHeading = useRef<HTMLParagraphElement>(null);
  const completed = useRef<AskResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const sources = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState(initialQuestion);
  const [result, setResult] = useState<AskResult | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) controller.current?.abort("closed");
    const frame = requestAnimationFrame(() => {
      if (open) {
        if (initialQuestion) setQuestion(initialQuestion);
        focusAskControl(input.current, panel.current);
      } else {
        setBusy(false);
        setSynthesizing(false);
      }
    });
    return () => { cancelAnimationFrame(frame); controller.current?.abort("closed"); };
  }, [open, initialQuestion]);

  const stop = () => {
    controller.current?.abort("stopped");
    setBusy(false);
    setSynthesizing(false);
    setError("Stopped. You can ask another question.");
    focusAskControl(input.current, panel.current);
  };

  const ask = async (value: string, selected?:{signalId:string;subject:string}) => {
    const trimmed = value.trim();
    if (trimmed.length < 3 || busy) return;
    const previous = completed.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setQuestion(trimmed);
    setBusy(true);
    setResult(null);
    setIncomplete(true);
    panel.current?.scrollTo({ top: 0 });
    focusAskControl(input.current, panel.current);
    setSynthesizing(false);
    setError("");
    const deadline = setTimeout(() => request.abort("timeout"), 40_000);
    try {
      const response = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/x-ndjson" }, cache: "no-store",
        body: JSON.stringify({ question: trimmed, ...(day ? { day } : {}),
          context: { ...(previous && !previous.needsClarification ? { question: (previous.intent === "comparison"
            ? `Compare ${previous.subjects?.join(" and ")}` : previous.subjects?.length===1 ? `Explain ${previous.subjects[0]}` : previous.question).slice(0,240),answer:previous.summary.slice(0,800) } : {}), ...((selected?.subject ?? subject) ? {subject:(selected?.subject ?? subject)?.slice(0,240)} : {}), ...((selected?.signalId ?? signalId ?? previous?.sourceSignalId) ? {signalId:selected?.signalId ?? signalId ?? previous?.sourceSignalId} : {}) } }), signal: request.signal,
      });
      if (response.status === 429) throw new Error("Ask is busy right now. Please try again after the limit resets.");
      if (!response.ok) throw new Error("Signals are unavailable right now. Try again shortly.");
      const answer: AskResult = response.headers.get("content-type")?.includes("application/x-ndjson")
        ? await readAskStream(response, preview => { if (!request.signal.aborted && controller.current === request) { setResult(preview); setSynthesizing(true); } })
        : await response.json();
      if (request.signal.aborted || controller.current !== request) return;
      const focusedControl = document.activeElement;
      completed.current = answer;
      setResult(answer);
      setIncomplete(false);
      onResult(answer);
      // A preview's source or follow-up can disappear after the citation audit.
      requestAnimationFrame(() => {
        if (open && focusedControl instanceof HTMLElement && !focusedControl.isConnected) answerHeading.current?.focus({ preventScroll: true });
      });
    } catch (cause) {
      if (controller.current !== request) return;
      if (request.signal.reason === "timeout") setError("Following these sources took too long. Please try again.");
      else if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Signals are unavailable right now. Try again shortly.");
    } finally {
      clearTimeout(deadline);
      if (controller.current === request) { setSynthesizing(false); setBusy(false); }
    }
  };

  return <section ref={panel} className="ask-panel" aria-label="Ask Symtri" tabIndex={-1} hidden={!open} inert={!open}>
    <div className="ask-panel-top"><span>ASK SYMTRI <i /> {day ? "HISTORICAL VIEW" : result?.scope === "knowledge" ? "KNOWLEDGE ARCHIVE" : "CURRENT SOURCES"}</span><button type="button" onClick={onClose} aria-label="Close Ask Symtri">×</button></div>
    <form onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
      <label htmlFor="symtri-question">Where should we look?</label>
      <div className="ask-input-row"><input ref={input} id="symtri-question" name="question" autoComplete="off" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What's happening with AI agents?" maxLength={240} /><button type="submit" disabled={busy || question.trim().length < 3} aria-label="Ask Symtri">↗</button></div>
    </form>
    {!result && !busy && <div className="ask-examples"><button type="button" onClick={() => void ask("What's happening with AI agents?")}>AI AGENTS ↗</button><button type="button" onClick={() => void ask("What connects nuclear energy and AI?")}>AI × ENERGY ↗</button></div>}
    <div className="ask-progress" role="status" aria-live="polite">{busy && <><p className="ask-state">{synthesizing ? "Sources found. Checking the answer…" : "Finding relevant sources…"}</p><button type="button" onClick={stop}>Stop</button></>}</div>
    {error && <div className="ask-state ask-state--error" role="alert"><p>{error}</p>{!busy && <button type="button" onClick={() => void ask(question)}>Try again</button>}</div>}
    {result && <div className="ask-result"><p ref={answerHeading} className="ask-answer-question" tabIndex={-1}>{result.question}</p>{incomplete && <p className="ask-preview-label">{busy ? "Source preview · answer is being checked" : "Source preview · synthesis did not finish"}</p>}
      {(result.summaryKind === "model" || result.events.length > 0) && <div className="ask-summary-heading">
        {result.summaryKind === "model" && <span className="ask-summary-label">SOURCE SYNTHESIS</span>}
        {result.events.length > 0 && <button type="button" onClick={() => sources.current?.scrollIntoView({ block: "nearest" })} aria-label={`Show ${result.events.length} sources`}>{result.events.length} {result.events.length === 1 ? "SOURCE" : "SOURCES"} ↓</button>}
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
