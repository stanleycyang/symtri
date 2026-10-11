import type { SignalEvent } from "./model";

export function signalContentKey(event: Pick<SignalEvent, "title" | "summary">): string {
  return `${event.title}\n${event.summary}`.trim().replace(/\s+/g, " ").toLowerCase();
}

export function canonicalSignalUrl(value: string): string {
  try {
    const url = new URL(value);
    const base = `${url.host}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
    const query = url.search.slice(1).split("&").filter((part) => {
      const key = part.split("=", 1)[0].toLowerCase();
      return key && !key.startsWith("utm_") && !["ref", "ref_src", "fbclid", "gclid"].includes(key);
    }).sort().join("&");
    return query ? `${base}?${query}` : base;
  } catch {
    return value.replace(/^https?:\/\//, "").split(/[?#]/, 1)[0].replace(/\/+$/, "").toLowerCase();
  }
}
