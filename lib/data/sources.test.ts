import assert from "node:assert/strict";
import test from "node:test";
import { fetchArxiv, fetchArxivForIngestion, fetchGitHub, fetchGitHubForIngestion, fetchHackerNews, fetchHackerNewsForIngestion } from "./sources";

test("hourly source sampling finds new items without widening the public sample", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const requestOptions: { cache: RequestCache | undefined; revalidate: number | false | undefined }[] = [];
  const pauses: number[] = [];
  const story = (id: number) => ({ id, type: "story", title: `AI agent story ${id}`, time: Math.floor(Date.now() / 1000), score: 10, url: `https://example.com/${id}` });
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
      const paper = query.includes("physics.plasm-ph")
        ? ["6", "Fusion confinement in a tokamak", "physics.plasm-ph"]
        : query.includes("physics.ao-ph") ? ["7", "Climate models for atmospheric prediction", "physics.ao-ph"]
        : query === "cat:astro-ph.EP" ? ["8", "Exoplanet atmospheres observed by JWST", "astro-ph.EP"]
        : params.get("max_results") === "55" || query.includes("q-fin.")
        ? ["5", "Liquidity in limit order books", "q-fin.TR"]
        : query.includes("astro-ph") ? ["4", "A new satellite observation", "astro-ph.CO"]
        : query.includes("q-bio") ? ["3", "Protein folding in cells", "q-bio.MN"]
        : query.includes("cs.CR") ? ["2", "Cybersecurity study", "cs.CR"]
        : ["1", "AI agent systems", "cs.AI"];
      const broadMatch = query.includes("physics.plasm-ph")
        ? `<entry><id>https://arxiv.org/abs/2609.12347v1</id><title>Unrelated plasma transport</title><summary>Fusion is mentioned in passing.</summary><published>${new Date().toISOString()}</published><category term="physics.plasm-ph" /></entry>`
        : "";
      return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2609.1234${paper[0]}v1</id><title>${paper[1]}</title><summary>A recent study.</summary><published>${new Date().toISOString()}</published><category term="${paper[2]}" /></entry>${broadMatch}</feed>`);
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
    assert.deepEqual(new Set(papers.map((event) => event.topics[0]?.topicId)), new Set(["ai", "security", "science", "space", "markets", "energy"]));
    assert.equal(papers.find((paper) => paper.title.includes("Climate models"))?.topics[0]?.subtopicId, "science-climate-science");
    assert.equal(papers.find((paper) => paper.title.includes("Exoplanet atmospheres"))?.topics[0]?.subtopicId, "space-astronomy");
    assert.equal(papers.find((paper) => paper.title.includes("tokamak"))?.topics[0]?.subtopicId, "energy-fusion");
    assert.equal(papers.some((paper) => paper.title === "Unrelated plasma transport"), false);
    assert.equal(requests.filter((url) => url.endsWith("/item/2.json")).length, 1);
    assert.equal(requests.some((url) => url.endsWith("/newstories.json")), true);
    assert.ok(requestOptions.every(({ cache, revalidate }) => cache === "no-store" && revalidate === undefined));
    assert.equal(requests.some((url) => url.includes("sort=updated")), true);
    assert.equal(requests.filter((url) => url.includes("export.arxiv.org/api/query")).length, 8);
    assert.deepEqual(pauses, [3000, 3000, 3000, 3000, 3000, 3000, 3000]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("arXiv retains successful groups and reports reduced source coverage", async () => {
  const originalFetch = globalThis.fetch;
  let failAll = false;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    const query = new URL(url).searchParams.get("search_query") ?? "";
    if (failAll || query.includes("cs.CR")) return new Response("Unavailable", { status: 503 });
    const id = requested.length;
    return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2609.1234${id}v1</id><title>Fusion research ${id}</title><summary>A recent study.</summary><published>${new Date().toISOString()}</published><category term="physics.plasm-ph" /></entry></feed>`);
  };
  try {
    const result = await fetchArxivForIngestion(async () => {});
    assert.equal(result.status, "partial");
    assert.equal(result.events.length, 7);
    assert.equal(requested.length, 9);
    failAll = true;
    await assert.rejects(fetchArxivForIngestion(async () => {}), /no usable papers/);
    assert.equal(requested.length, 25);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("arXiv retries a transient group failure before marking coverage partial", async () => {
  const originalFetch = globalThis.fetch;
  const attempts = new Map<string, number>();
  const pauses: number[] = [];
  globalThis.fetch = async (input) => {
    const query = new URL(String(input)).searchParams.get("search_query") ?? "";
    attempts.set(query, (attempts.get(query) ?? 0) + 1);
    if (query.includes("cs.CR") && attempts.get(query) === 1) return new Response("Unavailable", { status: 503 });
    return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2609.1234${attempts.size}v1</id><title>Fusion research ${attempts.size}</title><summary>A recent study.</summary><published>${new Date().toISOString()}</published><category term="physics.plasm-ph" /></entry></feed>`);
  };
  try {
    const result = await fetchArxivForIngestion(async (milliseconds) => { pauses.push(milliseconds); });
    assert.equal(result.status, "ok");
    assert.equal(attempts.get("cat:cs.CR OR cat:cs.SE OR cat:cs.NI"), 2);
    assert.equal(pauses.filter((pause) => pause === 6000).length, 1);
    assert.equal(pauses.filter((pause) => pause === 3000).length, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub keeps popular repositories but reports a missing recent search", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const sort = new URL(String(input)).searchParams.get("sort");
    if (sort === "updated") return new Response("Unavailable", { status: 503 });
    return Response.json({ items: [{ id: 42, full_name: "example/fusion-kit", created_at: new Date().toISOString(), html_url: "https://github.com/example/fusion-kit", description: "Fusion research tools", stargazers_count: 10, fork: false }] });
  };
  try {
    const result = await fetchGitHubForIngestion();
    assert.equal(result.status, "partial");
    assert.deepEqual(result.events.map((event) => event.externalId), ["42"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub waits for a search rate-limit reset and recovers once", async () => {
  const originalFetch = globalThis.fetch;
  const attempts: string[] = [];
  const pauses: number[] = [];
  const repo = (id: number) => ({ id, full_name: `example/repo-${id}`, created_at: new Date().toISOString(), html_url: `https://github.com/example/repo-${id}`, description: "AI agent tools", stargazers_count: 10, fork: false });
  globalThis.fetch = async (input) => {
    const sort = new URL(String(input)).searchParams.get("sort") ?? "";
    attempts.push(sort);
    if (sort === "stars" && attempts.length === 1) return Response.json({ message: "API rate limit exceeded" }, {
      status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 5) },
    });
    return Response.json({ items: [repo(sort === "stars" ? 41 : 42)] });
  };
  try {
    const result = await fetchGitHubForIngestion(async (milliseconds) => { pauses.push(milliseconds); });
    assert.equal(result.status, "ok");
    assert.deepEqual(result.events.map((event) => event.externalId), ["41", "42"]);
    assert.deepEqual(attempts, ["stars", "stars", "updated"]);
    assert.equal(pauses.length, 1);
    assert.ok(pauses[0] >= 1000 && pauses[0] <= 6000);
  } finally { globalThis.fetch = originalFetch; }
});

test("GitHub does not retry an unrelated forbidden response", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return Response.json({ message: "Resource not accessible" }, { status: 403 }); };
  try {
    await assert.rejects(fetchGitHubForIngestion(async () => { throw new Error("Unexpected pause"); }), /HTTP 403/);
    assert.equal(attempts, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("hourly Hacker News retries failed items and reports any remaining gaps", async () => {
  const originalFetch = globalThis.fetch;
  const attempts = new Map<number, number>();
  let permanentFailure = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/topstories.json")) return Response.json([1]);
    if (url.endsWith("/newstories.json")) return Response.json([2, 3]);
    const id = Number(url.match(/\/item\/(\d+)\.json$/)?.[1]);
    if (!id) throw new Error(`Unexpected source request: ${url}`);
    attempts.set(id, (attempts.get(id) ?? 0) + 1);
    if (id === 2 && (permanentFailure || attempts.get(id) === 1)) return new Response("Unavailable", { status: 503 });
    return Response.json({ id, type: "story", title: `AI agent story ${id}`, time: Math.floor(Date.now() / 1000), url: `https://example.com/${id}` });
  };
  try {
    const recovered = await fetchHackerNewsForIngestion();
    assert.equal(recovered.status, "ok");
    assert.deepEqual(new Set(recovered.events.map((event) => event.externalId)), new Set(["1", "2", "3"]));
    assert.equal(attempts.get(2), 2);
    permanentFailure = true;
    const partial = await fetchHackerNewsForIngestion();
    assert.equal(partial.status, "partial");
    assert.deepEqual(new Set(partial.events.map((event) => event.externalId)), new Set(["1", "3"]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hourly Hacker News replay covers stories missed by a previous run", async () => {
  const originalFetch = globalThis.fetch;
  const requestedItems: number[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/topstories.json")) return Response.json([1]);
    if (url.endsWith("/newstories.json")) return Response.json(Array.from({ length: 200 }, (_, index) => index + 2));
    const item = url.match(/\/item\/(\d+)\.json$/);
    if (item) {
      const id = Number(item[1]);
      requestedItems.push(id);
      return Response.json({ id, type: "story", title: `AI agent story ${id}`, time: Math.floor(Date.now() / 1000), score: 10, url: `https://example.com/${id}` });
    }
    throw new Error(`Unexpected source request: ${url}`);
  };
  try {
    const events = await fetchHackerNews(true);
    assert.equal(events.length, 181);
    assert.ok(requestedItems.includes(181));
    assert.equal(requestedItems.includes(182), false);
    assert.equal(requestedItems.includes(201), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hourly Hacker News ingestion reports stale or unavailable new stories", async () => {
  const originalFetch = globalThis.fetch;
  let failNewStories = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/topstories.json")) return Response.json([1]);
    if (url.endsWith("/newstories.json")) {
      if (failNewStories) return new Response("Unavailable", { status: 503 });
      return Response.json([2]);
    }
    const item = url.match(/\/item\/(\d+)\.json$/);
    if (item) return Response.json({ id: Number(item[1]), type: "story", title: "AI agent story", time: Number(item[1]) === 1 ? Math.floor(Date.now() / 1000) : Math.floor(Date.now() / 1000) - 3600, url: `https://example.com/${item[1]}` });
    throw new Error(`Unexpected source request: ${url}`);
  };
  try {
    await assert.rejects(fetchHackerNews(true), /new stories are stale/);
    failNewStories = true;
    await assert.rejects(fetchHackerNews(true), /HTTP 503/);
    assert.equal((await fetchHackerNews()).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
