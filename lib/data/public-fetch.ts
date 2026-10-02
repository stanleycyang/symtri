import { lookup } from "node:dns/promises";
import { Agent, request } from "undici";
import ipaddr from "ipaddr.js";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";

export function pinnedLookup(address: LookupAddress): LookupFunction {
  return (_hostname, options, callback) => {
    // Node's autoSelectFamily requests all:true; it requires an address array.
    if (options.all) {
      (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, [address]);
    } else callback(null, address.address, address.family);
  };
}

async function resolvePublicUrl(value: string, deadline: AbortSignal): Promise<{url: URL; address: LookupAddress}> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Only public HTTPS URLs are allowed");
  if (deadline.aborted) throw deadline.reason;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(deadline.reason);
    deadline.addEventListener("abort", onAbort, { once: true });
  });
  let addresses: LookupAddress[];
  try { addresses = await Promise.race([lookup(url.hostname, { all: true }), aborted]); }
  finally { deadline.removeEventListener("abort", onAbort); }
  if (!addresses.length || addresses.some(({ address }) => ipaddr.process(address).range() !== "unicast")) throw new Error("Feed destination is not public");
  return {url,address:addresses[0]};
}

export async function publicHttpsUrl(value: string): Promise<URL> {
  return (await resolvePublicUrl(value, AbortSignal.timeout(12_000))).url;
}

export async function fetchPublicText(value: string, maxBytes = 2_000_000): Promise<{ url: string; text: string; contentType: string }> {
  let target = value;
  const deadline = AbortSignal.timeout(12_000);
  for (let redirects = 0; redirects <= 2; redirects++) {
    const {url,address} = await resolvePublicUrl(target, deadline);
    const agent = new Agent({ connect: { lookup: pinnedLookup(address) } });
    try {
      const response = await request(url, {
        dispatcher: agent, signal: deadline, headersTimeout: 8_000, bodyTimeout: 8_000,
        headers: { "user-agent": "SYMTRI/0.1 (https://symtri.com)", accept: "application/rss+xml, application/atom+xml, application/xml, application/json, text/plain, text/xml, text/html" },
      });
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        target = new URL(String(response.headers.location), url).toString();
        response.body.destroy();
        continue;
      }
      if (response.statusCode !== 200) { response.body.destroy(); throw new Error(`Feed returned HTTP ${response.statusCode}`); }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error("Feed response too large");
        chunks.push(Buffer.from(chunk));
      }
      return { url: url.toString(), text: Buffer.concat(chunks).toString("utf8"), contentType: String(response.headers["content-type"] ?? "") };
    } finally { void agent.destroy().catch(() => {}); }
  }
  throw new Error("Too many feed redirects");
}

export function feedLinkFromHtml(html: string, pageUrl: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^\s"'>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const type = /\btype\s*=\s*["']?([^\s"'>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (rel !== "alternate" || !type || !/(rss|atom|xml)/.test(type) || !href) continue;
    try { const url = new URL(href, pageUrl); if (url.protocol === "https:") return url.toString(); } catch { /* Ignore malformed feed links. */ }
  }
  return null;
}
