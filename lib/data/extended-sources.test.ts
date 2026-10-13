import assert from "node:assert/strict";
import test from "node:test";
import { fetchCisa, fetchCuratedFeed, fetchEuropePmc, fetchHuggingFace, type PublicLoader } from "./extended-sources";
import { normalizeArxivFeed, normalizeSyndicationFeed } from "./normalize";
import { selectFeedEvents } from "./feed";

const abstract = "CRISPR researchers evaluated gene delivery in cell cultures. ".repeat(30);

test("Europe PMC keeps full abstracts, DOI identity, dates and preprint attribution within one query", async () => {
  const calls: string[] = [];
  const result = await fetchEuropePmc("hour:2026-09-28T04", async (url) => {
    calls.push(url);
    return { text: JSON.stringify({ resultList: { result: [
      { id: "42", source: "PPR", title: "CRISPR &lt;i&gt;delivery&lt;/i&gt; research", doi: "10.1234/GENOME", abstractText: abstract, firstPublicationDate: "2026-09-27", authorString: "Research authors", license: "cc-by" },
      { id: "43", source: "MED", title: "Future record", abstractText: abstract, firstPublicationDate: "2027-01-01" },
    ] } }) };
  });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).searchParams.get("pageSize"), "25");
  assert.match(new URL(calls[0]).searchParams.get("query")!, /2026-09-14 TO 2026-09-28/);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title,"CRISPR delivery research");
  assert.equal(result.events[0].url, "https://doi.org/10.1234/genome");
  assert.equal(result.events[0].evidence?.kind, "preprint");
  assert.ok(result.events[0].evidence!.text.length > 600);
  assert.equal(result.events[0].evidence?.license, "cc-by");
});

test("Europe PMC accepts an explicit manual run date without treating it as an hourly slot", async () => {
  let query="";
  await fetchEuropePmc("manual:2026-09-28T04:51:16.829Z",async url=>{
    query=new URL(url).searchParams.get("query")!;
    return {text:JSON.stringify({resultList:{result:[]}})};
  });
  assert.match(query,/2026-09-14 TO 2026-09-28/);
});

test("CISA uses one bounded catalog and preserves date-added semantics and actions", async () => {
  const result = await fetchCisa(async (_url, maxBytes) => {
    assert.equal(maxBytes, 4_000_000);
    return { text: JSON.stringify({ catalogVersion: "test", vulnerabilities: Array.from({ length: 70 }, (_, i) => ({
      cveID: `CVE-2026-${1000 + i}`, vulnerabilityName: "Buffer overflow", shortDescription: "A buffer overflow permits remote code execution.",
      requiredAction: "Apply vendor updates", knownRansomwareCampaignUse: "Unknown", dateAdded: "2026-09-27", dueDate: "2026-10-01", vendorProject: "Example", product: "Server",
    })) }) };
  });
  assert.equal(result.events.length, 50);
  assert.equal(result.events[0].topics[0]?.topicId, "security");
  assert.match(result.events[0].evidence!.text, /Apply vendor updates/);
  assert.match(result.events[0].evidence!.text, /Added to the KEV catalog: 2026-09-27 \(not the first disclosure date\)/);
  assert.equal(result.events[0].evidence?.metadata?.dateMeaning, "Added to KEV, not first disclosure");
});

test("curated NASA feed retains text independently of the map excerpt", async () => {
  const xml = `<rss><channel><item><title>New mission discovery</title><link>https://www.nasa.gov/example</link><pubDate>Sun, 27 Sep 2026 10:00:00 GMT</pubDate><description>${abstract}</description></item></channel></rss>`;
  const result = await fetchCuratedFeed("nasa", async (url) => { assert.match(url, /news-release\/feed/); return { text: xml }; });
  assert.equal(result.events[0].source, "nasa");
  assert.equal(result.events[0].evidence?.attribution, "NASA");
  assert.ok(result.events[0].topics.some((topic) => topic.topicId === "space"));
  assert.ok(result.events[0].evidence!.text.length > 600);
  assert.equal(selectFeedEvents(result.events)[0].evidence, undefined);
  assert.equal(normalizeSyndicationFeed(xml, "nasa")[0].evidence?.license, null);
  const paper = normalizeArxivFeed(`<feed><entry><id>https://arxiv.org/abs/2609.12345</id><title>AI research</title><published>2026-09-27</published><summary>${abstract}</summary></entry></feed>`)[0];
  assert.ok(paper.evidence!.text.length > paper.summary.length);
});

test("CISA notices revisions outside its newest 50 entries and skips unchanged evidence", async () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ cveID: `CVE-2026-${1000 + i}`, vulnerabilityName: "Buffer overflow",
    shortDescription: "A vulnerability allows remote code execution.", requiredAction: "Apply updates", dateAdded: `2026-09-${i < 50 ? "27" : "01"}` }));
  const load = async () => ({ text: JSON.stringify({ vulnerabilities: items }) });
  const first = await fetchCisa(load);
  const known = Object.fromEntries(first.events.map((event) => [event.externalId, String(event.evidence!.metadata!.entryHash)]));
  const next = await fetchCisa(load, known);
  assert.equal(next.events.length, 10);
  Object.assign(known, Object.fromEntries(next.events.map((event) => [event.externalId, String(event.evidence!.metadata!.entryHash)])));
  assert.equal((await fetchCisa(load, known)).events.length, 0);
  items[59].requiredAction = "New vendor mitigation";
  const updated = await fetchCisa(load, known);
  assert.equal(updated.events.length, 1);
  assert.equal(updated.events[0].externalId, items[59].cveID);
  assert.match(updated.events[0].evidence!.text, /New vendor mitigation/);
});

test("Hugging Face bounds card requests, keeps both source types and separates updates", async () => {
  const calls: string[] = [];
  const loader: PublicLoader = async (url) => {
    calls.push(url);
    if (url.includes("?sort=")) return { text: JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ id: `example/repo-${i}`, downloads: 100, createdAt: "2026-09-25", lastModified: "2026-09-27" }))) };
    if (url.includes("/api/")) return { text: JSON.stringify({ createdAt: "2026-09-25", lastModified: "2026-09-27", cardData: { license: "apache-2.0" } }) };
    return { text: `---\nlicense: apache-2.0\n---\n${abstract}` };
  };
  const result = await fetchHuggingFace(loader);
  assert.equal(calls.length, 18);
  assert.ok(calls.filter(url => url.includes("?sort=")).every(url => !url.includes("full=true")));
  assert.ok(calls.filter(url => !url.includes("/api/")).every(url => url.includes("/resolve/main/README.md")));
  assert.equal(result.events.length, 8);
  assert.equal(result.status, "ok");
  assert.equal(result.events[0].publishedAt, "2026-09-27T00:00:00.000Z");
  assert.equal(result.events[0].evidence?.metadata?.updatedAt, "2026-09-27T00:00:00.000Z");
  assert.equal(result.events[0].evidence?.metadata?.createdAt,"2026-09-25T00:00:00.000Z");
  assert.match(result.events[0].title,/model update/);
  assert.equal(result.events[0].evidence?.metadata?.changeKind,"update");
  assert.equal(result.events[0].evidence?.license, "apache-2.0");
  assert.deepEqual(new Set(result.events.map((event) => event.evidence?.kind)), new Set(["model-card", "dataset-card"]));
  const partial = await fetchHuggingFace(async (url, bytes) => {
    if (url.includes("/datasets")) throw new Error("unavailable");
    return loader(url, bytes);
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.events.length, 4);
});

test("Hugging Face replaces missing cards without losing healthy source coverage", async () => {
  let calls = 0;
  const result = await fetchHuggingFace(async url => {
    calls++;
    if (url.includes("?sort=")) return {text: JSON.stringify(Array.from({length:30}, (_, i) => ({id:`example/repo-${i}`, downloads:100})))};
    if (url.includes("/api/")) return {text: JSON.stringify({createdAt:"2026-09-25", lastModified:"2026-09-27"})};
    if (/repo-[0-3]\//.test(url)) throw new Error("Feed returned HTTP 404");
    return {text:abstract};
  });
  assert.equal(calls, 34);
  assert.equal(result.status, "ok");
  assert.equal(result.events.length, 8);
});

test("Hugging Face bounds empty and short-card samples and reports real failures", async () => {
  let calls = 0;
  const empty = async (url:string) => {
    calls++;
    if (url.includes("?sort=")) return {text: JSON.stringify(Array.from({length:30}, (_, i) => ({id:`example/repo-${i}`, downloads:100})))};
    if (url.includes("/api/")) return {text: JSON.stringify({createdAt:"2026-09-25", lastModified:"2026-09-27"})};
    return {text:"No documented evidence"};
  };
  await assert.rejects(fetchHuggingFace(empty), /cards unavailable/);
  assert.equal(calls, 34);
  const partial = await fetchHuggingFace(async url => {
    if (url.includes("?sort=")) return {text:JSON.stringify([{id:"example/first",downloads:100},{id:"example/second",downloads:100}])};
    if (url.includes("/api/")) return {text:JSON.stringify({createdAt:"2026-09-25",lastModified:"2026-09-27"})};
    if(url.includes("/first/")) throw new Error("Feed returned HTTP 429");
    return {text:abstract};
  });
  assert.equal(partial.status,"partial");
  assert.equal(partial.events.length,2);
});

test("Hugging Face checks access restrictions absent from compact listings before downloading cards", async () => {
  let cards = 0;
  const result = await fetchHuggingFace(async url => {
    if (url.includes("?sort=")) return {text:JSON.stringify([{id:"example/gated",downloads:100},{id:"example/public",downloads:100}])};
    if (url.includes("/api/")) return {text:JSON.stringify({createdAt:"2026-09-25",lastModified:"2026-09-27",gated:url.includes("/gated?")})};
    cards++;
    assert.ok(!url.includes("/gated/"));
    return {text:abstract};
  });
  assert.equal(cards,2);
  assert.equal(result.events.length,2);
  assert.equal(result.status,"partial");
});
