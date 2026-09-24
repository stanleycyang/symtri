"use client";

import { useEffect, useRef, useState } from "react";
import type { AskResult } from "@/lib/ai/ask";

type Props = {
  day: string | null;
  onClose: () => void;
  onResult: (result: AskResult) => void;
  onNavigate: (regionId: string, subtopicId: string | null) => void;
};

const sourceNames = { "hacker-news": "HACKER NEWS", github: "GITHUB", arxiv: "ARXIV" } as const;

export default function AskSymtri({ day, onClose, onResult, onNavigate }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { input.current?.focus(); return () => controller.current?.abort(); }, []);

  const ask = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 3 || busy) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setQuestion(trimmed);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ question: trimmed, ...(day ? { day } : {}) }), signal: request.signal,
      });
      if (!response.ok) throw new Error("The map could not answer from its current signals.");
      const answer: AskResult = await response.json();
      setResult(answer);
      onResult(answer);
    } catch {
      if (!request.signal.aborted) setError("Signals are unavailable right now. Try again shortly.");
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

  return <section className="ask-panel" aria-label="Ask Symtri">
    <div className="ask-panel-top"><span>ASK SYMTRI <i /> {day ? "HISTORICAL SAMPLE" : result?.scope === "knowledge" ? "KNOWLEDGE ARCHIVE" : "CURRENT SAMPLE"}</span><button type="button" onClick={onClose} aria-label="Close Ask Symtri">×</button></div>
    <form onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
      <label htmlFor="symtri-question">Where should we look?</label>
      <div className="ask-input-row"><input ref={input} id="symtri-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What's happening with AI agents?" maxLength={240} /><button type="submit" disabled={busy || question.trim().length < 3} aria-label="Ask Symtri">↗</button></div>
    </form>
    {!result && !busy && <div className="ask-examples"><button type="button" onClick={() => void ask("What's happening with AI agents?")}>AI AGENTS ↗</button><button type="button" onClick={() => void ask("What connects nuclear energy and AI?")}>AI × ENERGY ↗</button></div>}
    {busy && <p className="ask-state">FOLLOWING THE SIGNALS…</p>}
    {error && <p className="ask-state ask-state--error" role="alert">{error}</p>}
    {result && <div className="ask-result" aria-live="polite">
      {result.summaryKind === "model" && <span className="ask-summary-label">SOURCE SYNTHESIS</span>}
      <p className="ask-summary">{result.summary}</p>
      {result.pathSteps.length > 0 && <><span className="ask-path-label">{result.regionIds.length > 1 ? "CONCEPTUAL MAP ROUTE" : "MAP LOCATION"}</span><div className="ask-path" aria-label="Highlighted map path">{result.pathSteps.map((step, index) => <span key={`${step.regionId}:${step.subtopicId ?? "region"}`}>{index > 0 && <b>↗</b>}<button type="button" onClick={() => onNavigate(step.regionId, step.subtopicId)}>{step.label.toUpperCase()}</button></span>)}</div></>}
      {result.events.length > 0 && <div className="ask-sources"><span>{result.scope === "knowledge" ? "FROM THE KNOWLEDGE ARCHIVE" : result.retrieval === "semantic-assisted" ? "RANKED BY MEANING · SAMPLE" : "FROM THE SAMPLE"}</span>{result.events.map((event) => <a key={event.id} href={event.url} target="_blank" rel="noopener noreferrer"><small>{sourceNames[event.source]}{result.citedEventIds.includes(event.id) && " · CITED"}</small>{event.title}<b>↗</b></a>)}</div>}
    </div>}
  </section>;
}
