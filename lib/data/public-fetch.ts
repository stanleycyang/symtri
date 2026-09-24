import { lookup } from "node:dns/promises";
import { Agent, request } from "undici";
import ipaddr from "ipaddr.js";

export async function publicHttpsUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Only public HTTPS URLs are allowed");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => ipaddr.process(address).range() !== "unicast")) throw new Error("Feed destination is not public");
  return url;
}

export async function fetchPublicText(value: string, maxBytes = 2_000_000): Promise<{ url: string; text: string; contentType: string }> {
  let target = value;
  for (let redirects = 0; redirects <= 2; redirects++) {
    const url = await publicHttpsUrl(target);
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => ipaddr.process(address).range() !== "unicast")) throw new Error("Feed destination is not public");
    const address = addresses[0];
    const agent = new Agent({ connect: { lookup: (_hostname, _options, callback) => callback(null, address.address, address.family) } });
    try {
      const response = await request(url, {
        dispatcher: agent, headersTimeout: 8_000, bodyTimeout: 8_000,
        headers: { "user-agent": "SYMTRI/0.1 (https://symtri.com)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html" },
      });
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        target = new URL(String(response.headers.location), url).toString();
        await response.body.dump();
        continue;
      }
      if (response.statusCode !== 200) { await response.body.dump(); throw new Error(`Feed returned HTTP ${response.statusCode}`); }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error("Feed response too large");
        chunks.push(Buffer.from(chunk));
      }
      return { url: url.toString(), text: Buffer.concat(chunks).toString("utf8"), contentType: String(response.headers["content-type"] ?? "") };
    } finally { await agent.close(); }
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
