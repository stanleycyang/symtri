import assert from "node:assert/strict";
import test from "node:test";
import { canPrefetchTopic, createTopicFeedCache, topicRevisionScope, type TopicFeedSnapshot } from "./topic-feed-cache";
import type { TopicSourcePage } from "./model";
const page: TopicSourcePage = { events: [], nextCursor: "next", revision: "13:5:1:1" };
const snapshot: TopicFeedSnapshot = { ...page, firstPage: page, scrollTop: 400 };

test("topic prefetch and a click share one request and reuse its result", async () => {
  let calls = 0;
  let finish!: (response: Response) => void;
  const cache = createTopicFeedCache({ fetcher: async () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); } });
  const first = cache.request("/topic?cursor=next");
  const second = cache.request("/topic?cursor=next");
  assert.equal(calls, 1);
  finish(Response.json(page));
  assert.deepEqual(await first, await second);
  await cache.request("/topic?cursor=next");
  assert.equal(calls, 1);
});

test("topic snapshots expire, evict least recent nodes, and keep scroll anchors", () => {
  let time = 0;
  const cache = createTopicFeedCache({ now: () => time, maxNodes: 2, ttl: 100 });
  cache.save("software", snapshot); cache.save("energy", snapshot);
  assert.equal(cache.read("software")?.scrollTop, 400);
  cache.save("space", { ...snapshot, revision: "new" });
  assert.equal(cache.read("energy"), null);
  assert.equal(cache.read("space")?.revision, "new");
  time = 101;
  assert.equal(cache.read("software"), null);
});

test("first-page revalidation bypasses cached responses and failed requests can retry", async () => {
  let calls = 0;
  const cache = createTopicFeedCache({ fetcher: async () => {
    calls++;
    return calls === 1 ? new Response("", { status: 503 }) : Response.json({ ...page, revision: String(calls) });
  } });
  await assert.rejects(cache.request("/topic"));
  assert.equal((await cache.request("/topic")).revision, "2");
  assert.equal((await cache.request("/topic", true)).revision, "3");
});

test("speculative fetching honors data saving and slow connections", () => {
  assert.equal(canPrefetchTopic(), true);
  assert.equal(canPrefetchTopic({ saveData: true }), false);
  assert.equal(canPrefetchTopic({ effectiveType: "2g" }), false);
  assert.equal(canPrefetchTopic({ effectiveType: "4g" }), true);
});

test("list scope identifies classifier and catalog independently of publication changes", () => {
  assert.equal(topicRevisionScope("13:5:42:100:active"), "13:42");
  assert.equal(topicRevisionScope("13:5:42:101:paused"), "13:42");
  assert.notEqual(topicRevisionScope("14:5:42:101:active"), "13:42");
});
