import assert from "node:assert/strict";
import test from "node:test";
import { fetchGitHub, fetchHackerNews } from "./sources";

test("hourly source sampling finds new items without widening the public sample", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const story = (id: number) => ({ id, type: "story", title: `AI agent story ${id}`, time: 1780000000, score: 10, url: `https://example.com/${id}` });
  const repo = (id: number) => ({ id, full_name: `example/repo-${id}`, created_at: "2026-09-22T12:00:00Z", html_url: `https://github.com/example/repo-${id}`, description: "Open source database", stargazers_count: 10, fork: false });
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/topstories.json")) return Response.json([1, 2]);
    if (url.endsWith("/newstories.json")) return Response.json([2, 3]);
    const item = url.match(/\/item\/(\d+)\.json$/);
    if (item) return Response.json(story(Number(item[1])));
    if (url.includes("/search/repositories")) return Response.json({ items: [repo(new URL(url).searchParams.get("sort") === "updated" ? 11 : 10)] });
    throw new Error(`Unexpected source request: ${url}`);
  };
  try {
    assert.deepEqual((await fetchHackerNews()).map((event) => event.externalId), ["1", "2"]);
    assert.deepEqual((await fetchGitHub()).map((event) => event.externalId), ["10"]);
    assert.equal(requests.some((url) => url.endsWith("/newstories.json")), false);
    assert.equal(requests.some((url) => url.includes("sort=updated")), false);

    requests.length = 0;
    assert.deepEqual((await fetchHackerNews(true)).map((event) => event.externalId), ["1", "2", "3"]);
    assert.deepEqual((await fetchGitHub(true)).map((event) => event.externalId), ["10", "11"]);
    assert.equal(requests.filter((url) => url.endsWith("/item/2.json")).length, 1);
    assert.equal(requests.some((url) => url.endsWith("/newstories.json")), true);
    assert.equal(requests.some((url) => url.includes("sort=updated")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
