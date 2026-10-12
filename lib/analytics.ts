"use client";
import {track} from "@vercel/analytics";
type Event = "enter_universe" | "select_region" | "select_topic" | "share" | "ask_symtri_open" | "ask_symtri_submit" | "outbound_source";
export function trackEvent(name: Event, props: {id?: string; point?: string; channel?: string; source?: string; sourceId?: string} = {}) {
  try { track(name, props); } catch { /* Analytics must never interrupt exploration. */ }
}
