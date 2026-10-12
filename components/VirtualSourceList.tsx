"use client";
import { defaultRangeExtractor, useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TopicSource } from "@/lib/data/model";

export default function VirtualSourceList({ events, hidden, focusedId, restoreFocus, initialOffset, measurements, onMeasurements, sourceLabel, dateLabel, onFocus, onSelect }: {
  events: TopicSource[]; hidden: boolean; focusedId: string | null; restoreFocus: boolean;
  initialOffset: number; measurements?: VirtualItem[]; onMeasurements: (reader: (() => VirtualItem[]) | null) => void;
  sourceLabel: (event: TopicSource) => string; dateLabel: (event: TopicSource) => string;
  onFocus: (id: string) => void; onSelect: (event: TopicSource, control: HTMLButtonElement) => void;
}) {
  "use no memo";
  const list = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [margin, setMargin] = useState(0);
  const focusedIndex = events.findIndex(event => event.id === focusedId);
  const getItemKey = useCallback((index: number) => events[index].id, [events]);
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const visible = defaultRangeExtractor(range);
    return focusedIndex >= 0 ? [...new Set([...visible, focusedIndex])].sort((a,b) => a-b) : visible;
  }, [focusedIndex]);
  // eslint-disable-next-line react-hooks/incompatible-library -- This isolated component opts out of compiler memoization above.
  const virtual = useVirtualizer({ count: events.length, getScrollElement: () => list.current?.closest<HTMLElement>(".detail-panel") ?? null,
    estimateSize: () => 104, initialOffset, initialMeasurementsCache: measurements, getItemKey, overscan: 8, scrollMargin: margin, rangeExtractor, useCachedMeasurements: hidden });
  useLayoutEffect(() => {
    onMeasurements(virtual.takeSnapshot);
    return () => onMeasurements(null);
  }, [onMeasurements,virtual]);
  useEffect(() => {
    const element = list.current;
    const panel = element?.closest<HTMLElement>(".detail-panel");
    if (!element || !panel || hidden) return;
    const measure = () => setMargin(element.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - panel.clientTop);
    const observer = new ResizeObserver(measure);
    observer.observe(panel); observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    for (const header of panel.querySelectorAll(".panel-top,h3,.panel-description,.activity-readout")) observer.observe(header);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [hidden]);
  useEffect(() => {
    if (!restoreFocus || !focusedId || hidden) return;
    requestAnimationFrame(() => {
      const button = buttons.current.get(focusedId);
      button?.scrollIntoView({block:"nearest"});
      button?.focus({preventScroll:true});
    });
  }, [restoreFocus,focusedId,hidden]);
  const keyboard = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowDown" ? index+1 : event.key === "ArrowUp" ? index-1 : event.key === "Home" ? 0 : event.key === "End" ? events.length-1 : null;
    if (next === null || next < 0 || next >= events.length) return;
    event.preventDefault(); onFocus(events[next].id); virtual.scrollToIndex(next, { align: next===events.length-1 ? "start" : "auto" });
    requestAnimationFrame(() => buttons.current.get(events[next].id)?.focus({ preventScroll: true }));
  };
  return <div ref={list} className="signal-list virtual-source-list" role="list" style={{ height: virtual.getTotalSize(), position: "relative" }}>
    {virtual.getVirtualItems().map(row => {
      const event = events[row.index];
      return <div key={row.key} ref={virtual.measureElement} data-index={row.index} role="listitem" aria-posinset={row.index+1} aria-setsize={events.length}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start-margin}px)` }}>
        <button type="button" data-source-id={event.id} ref={node => { if (node) buttons.current.set(event.id,node); else buttons.current.delete(event.id); }}
          onFocus={() => onFocus(event.id)} onKeyDown={key => keyboard(key,row.index)} onClick={click => onSelect(event,click.currentTarget)}>
          <span>{sourceLabel(event).toUpperCase()} · {dateLabel(event).toUpperCase()}</span><strong>{event.title}</strong><span className="signal-list-arrow" aria-hidden="true">↗</span>
        </button>
      </div>;
    })}
  </div>;
}
