import type { VirtualItem } from "@tanstack/react-virtual";
import type { TopicSourcePage } from "./model";

export type TopicFeedSnapshot = TopicSourcePage & { firstPage: TopicSourcePage; scrollTop: number; measurements?: VirtualItem[]; anchor?: { id: string; offset: number; kind?: "source" | "footer" } };
export function topicRevisionScope(revision: string): string {
  const parts = revision.split(":");
  return parts.length >= 3 ? `${parts[0]}:${parts[2]}` : "";
}

export function canPrefetchTopic(connection?: { saveData?: boolean; effectiveType?: string }): boolean {
  return !connection?.saveData && !["slow-2g", "2g"].includes(connection?.effectiveType ?? "");
}

export function createTopicFeedCache({ now = Date.now, fetcher = (...args: Parameters<typeof fetch>) => fetch(...args), maxNodes = 6, maxRows = 3000, ttl = 5 * 60_000 } = {}) {
  const nodes = new Map<string, { value: TopicFeedSnapshot; expires: number }>();
  const pages = new Map<string, { value: TopicSourcePage; expires: number }>();
  const requests = new Map<string, Promise<TopicSourcePage>>();
  return {
    read(key: string): TopicFeedSnapshot | null {
      const saved = nodes.get(key);
      if (!saved || saved.expires < now()) { nodes.delete(key); return null; }
      nodes.delete(key); nodes.set(key, saved);
      return saved.value;
    },
    save(key: string, value: TopicFeedSnapshot): void {
      nodes.delete(key);
      if (value.events.length > maxRows) return;
      nodes.set(key, { value, expires: now() + ttl });
      while (nodes.size > maxNodes || [...nodes.values()].reduce((sum, item) => sum + item.value.events.length, 0) > maxRows) {
        nodes.delete(nodes.keys().next().value!);
      }
    },
    request(url: string, revalidate = false): Promise<TopicSourcePage> {
      const pending = requests.get(url);
      if (pending) return pending;
      const saved = pages.get(url);
      if (!revalidate && saved && saved.expires >= now()) return Promise.resolve(saved.value);
      const promise = fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) }).then(async response => {
        if (!response.ok) throw new Error("Sources unavailable");
        const page: TopicSourcePage = await response.json();
        if (!Array.isArray(page.events) || typeof page.revision !== "string" || (page.nextCursor !== null && typeof page.nextCursor !== "string")) throw new Error("Invalid source page");
        pages.delete(url); pages.set(url, { value: page, expires: now() + 30_000 });
        while (pages.size > 24) pages.delete(pages.keys().next().value!);
        return page;
      }).finally(() => requests.delete(url));
      requests.set(url, promise);
      return promise;
    },
  };
}

export const topicFeedCache = createTopicFeedCache();
