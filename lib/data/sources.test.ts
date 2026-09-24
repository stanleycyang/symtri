import assert from "node:assert/strict";
import test from "node:test";
import { fetchArxiv, fetchGitHub, fetchHackerNews } from "./sources";

test("hourly source sampling finds new items without widening the public sample", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const requestOptions: { cache: RequestCache | undefined; revalidate: number | false | undefined }[] = [];
  const pauses: number[] = [];
  const story = (id: number) => ({ id, type: "story", title: `AI agent story ${id}`, time: 1780000000, score: 10, url: `https://example.com/${id}` });
  const repo = (id: number) => ({ id, full_name: `example/repo-${id}`, created_at: "2026-09-22T12:00:00Z", html_url: `https://github.com/example/repo-${id}`, description: "Open source database", stargazers_count: 10, fork: false });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    requestOptions.push({ cache: init?.cache, revalidate: init?.next?.revalidate });
    if (url.endsWith("/topstories.json")) return Response.json([1, 2]);
    if (url.endsWith("/newstories.json")) return Response.json([2, 3]);
    const item = url.match(/\/item\/(\d+)\.json$/);
    if (item) return Response.json(story(Number(item[1])));
    if (url.includes("/search/repositories")) return Response.json({ items: [repo(new URL(url).searchParams.get("sort") === "updated" ? 11 : 10)] });
    if (url.includes("export.arxiv.org/api/query")) {
      const params = new URL(url).searchParams;
      const query = params.get("search_query") ?? "";
      const paper = params.get("max_results") === "55" || query.includes("q-fin.")
        ? ["5", "Liquidity in limit order books", "q-fin.TR"]
        : query.includes("astro-ph") ? ["4", "A new satellite observation", "astro-ph.CO"]
        : query.includes("q-bio") ? ["3", "Protein folding in cells", "q-bio.MN"]
        : query.includes("cs.CR") ? ["2", "Cybersecurity study", "cs.CR"]
        : ["1", "AI agent systems", "cs.AI"];
      return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2609.1234${paper[0]}v1</id><title>${paper[1]}</title><summary>A recent study.</summary><published>${new Date().toISOString()}</published><category term="${paper[2]}" /></entry></feed>`);
    }
    throw new Error(`Unexpected source request: ${url}`);
  };
  try {
    assert.deepEqual((await fetchHackerNews()).map((event) => event.externalId), ["1", "2"]);
    assert.deepEqual((await fetchGitHub()).map((event) => event.externalId), ["10"]);
    assert.equal((await fetchArxiv())[0]?.topics[0]?.topicId, "markets");
    assert.equal(requests.some((url) => url.endsWith("/newstories.json")), false);
    assert.ok(requestOptions.every(({ cache, revalidate }) => cache === undefined && revalidate === 900));
    assert.equal(requests.some((url) => url.includes("sort=updated")), false);
    assert.equal(requests.some((url) => url.includes("max_results=55")), true);

    requests.length = 0;
    requestOptions.length = 0;
    assert.deepEqual((await fetchHackerNews(true)).map((event) => event.externalId), ["1", "2", "3"]);
    assert.deepEqual((await fetchGitHub(true)).map((event) => event.externalId), ["10", "11"]);
    const papers = await fetchArxiv(true, async (milliseconds) => { pauses.push(milliseconds); });
    assert.deepEqual(new Set(papers.map((event) => event.topics[0]?.topicId)), new Set(["ai", "security", "science", "space", "markets"]));
    assert.equal(requests.filter((url) => url.endsWith("/item/2.json")).length, 1);
    assert.equal(requests.some((url) => url.endsWith("/newstories.json")), true);
    assert.ok(requestOptions.every(({ cache, revalidate }) => cache === "no-store" && revalidate === undefined));
    assert.equal(requests.some((url) => url.includes("sort=updated")), true);
    assert.equal(requests.filter((url) => url.includes("export.arxiv.org/api/query")).length, 5);
    assert.deepEqual(pauses, [3000, 3000, 3000, 3000]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
