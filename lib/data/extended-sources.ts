import { createHash } from "node:crypto";
import { classifySignal } from "./classify";
import { cleanSourceText, normalizeSyndicationFeed } from "./normalize";
import { fetchPublicText } from "./public-fetch";
import type { SignalEvent, SourceEvidence } from "./model";

type Sample = { events: SignalEvent[]; status: "ok" | "partial" };
export type PublicLoader = (url: string, maxBytes?: number) => Promise<{ text: string }>;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const date = (value: unknown) => { const parsed = Date.parse(text(value)); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; };

function signal(source: string, externalId: string, title: string, url: string, publishedAt: string, evidence: SourceEvidence, categories: string[] = []): SignalEvent {
  const summary = evidence.text.slice(0, 600);
  return { id: `${source}:${externalId}`, source, externalId, title, url, summary, publishedAt, importance: 25,
    topics: classifySignal(title, summary, categories), classificationInput: { title, summary, categories }, evidence };
}

export async function fetchCuratedFeed(source: "nasa" | "nasa-jpl", load: PublicLoader = fetchPublicText): Promise<Sample> {
  const url = source === "nasa" ? "https://www.nasa.gov/news-release/feed/" : "https://www.nasa.gov/centers-and-facilities/jpl/feed/";
  const events = normalizeSyndicationFeed((await load(url)).text, source).slice(0, 20);
  if (!events.length) throw new Error("Curated feed has no usable items");
  return { status: "ok", events: events.map((event) => ({ ...event,
    // NASA attribution is a routing hint, not a fabricated story assertion.
    topics: classifySignal(`${event.title} NASA`, event.summary),
    classificationInput: { title: `${event.title} NASA`, summary: event.summary, categories: [] },
    evidence: { ...event.evidence!, attribution: source === "nasa" ? "NASA" : "NASA Jet Propulsion Laboratory",
      metadata: { feedUrl: url } } })) };
}

function cisaEntryHash(item: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(Object.keys(item).sort().map((key) => [key, item[key]]))).digest("hex");
}

export async function fetchCisa(load: PublicLoader = fetchPublicText, knownHashes: Record<string, string> = {}): Promise<Sample> {
  const catalogUrl = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
  const data = record(JSON.parse((await load(catalogUrl, 4_000_000)).text));
  if (!Array.isArray(data.vulnerabilities)) throw new Error("Invalid CISA catalog");
  const usable = data.vulnerabilities.map(record).filter((item) => /^CVE-\d{4}-\d{4,}$/.test(text(item.cveID)) && date(item.dateAdded) && text(item.shortDescription));
  if (!usable.length) throw new Error("No usable CISA entries");
  const events = usable.sort((a, b) => text(b.dateAdded).localeCompare(text(a.dateAdded)))
    .filter((item) => knownHashes[text(item.cveID)] !== cisaEntryHash(item))
    .slice(0, 50).flatMap((item): SignalEvent[] => {
      const id = text(item.cveID);
      const publishedAt = date(item.dateAdded);
      if (!/^CVE-\d{4}-\d{4,}$/.test(id) || !publishedAt || !text(item.shortDescription)) return [];
      const content = `${cleanSourceText(item.shortDescription)} Required action: ${cleanSourceText(item.requiredAction)}. Known ransomware campaign use: ${cleanSourceText(item.knownRansomwareCampaignUse)}. Added to the KEV catalog: ${text(item.dateAdded)} (not the first disclosure date). Action due date: ${text(item.dueDate)}.`;
      return [signal("cisa", id, `${id}: ${cleanSourceText(item.vulnerabilityName)}`, `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${id}`, publishedAt,
        { text: content, kind: "advisory", url: catalogUrl, attribution: "CISA Known Exploited Vulnerabilities Catalog", license: null,
          retrievedAt: new Date().toISOString(), metadata: { vendor: text(item.vendorProject), product: text(item.product), dateAdded: text(item.dateAdded), dueDate: text(item.dueDate), catalogVersion: text(data.catalogVersion), entryHash: cisaEntryHash(item), dateMeaning: "Added to KEV, not first disclosure" } }, ["cs.CR"])];
    });
  return { events, status: usable.length < data.vulnerabilities.length ? "partial" : "ok" };
}

export async function fetchEuropePmc(slot: string, load: PublicLoader = fetchPublicText): Promise<Sample> {
  const hour = slot.startsWith("manual:") ? Date.parse(slot.slice(7)) : Date.parse(`${slot.replace(/^hour:/, "")}:00:00Z`);
  if (!Number.isFinite(hour)) throw new Error("Invalid Europe PMC slot");
  const from = new Date(hour - 14 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(hour).toISOString().slice(0, 10);
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", `FIRST_PDATE:[${from} TO ${to}] AND HAS_ABSTRACT:Y AND (CRISPR OR neuroscience OR biotechnology OR genome) NOT PUB_TYPE:Review`);
  url.searchParams.set("format", "json"); url.searchParams.set("resultType", "core"); url.searchParams.set("pageSize", "25"); url.searchParams.set("sort", "FIRST_PDATE_D desc");
  const data = record(JSON.parse((await load(url.toString())).text));
  const items = record(data.resultList).result;
  if (!Array.isArray(items)) throw new Error("Invalid Europe PMC response");
  const events = items.flatMap((input): SignalEvent[] => {
    const item = record(input); const id = text(item.id); const source = text(item.source);
    const title = cleanSourceText(item.title); const abstract = cleanSourceText(item.abstractText);
    const publishedAt = date(item.firstPublicationDate);
    if (!id || !/^[A-Z]+$/.test(source) || !title || abstract.length < 100 || !publishedAt || Date.parse(publishedAt) > hour + 86_400_000) return [];
    const doi = text(item.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    const url = doi ? `https://doi.org/${doi.toLowerCase()}` : `https://europepmc.org/article/${source}/${encodeURIComponent(id)}`;
    const preprint = source === "PPR" || JSON.stringify(item.pubTypeList).toLowerCase().includes("preprint");
    return [signal("europe-pmc", `${source}-${id}`, title, url, publishedAt,
      { text: abstract.slice(0, 12000), kind: preprint ? "preprint" : "abstract", url, attribution: cleanSourceText(item.authorString) || "Publication authors via Europe PMC",
        license: text(item.license) || null, retrievedAt: new Date().toISOString(), metadata: { publicationType: preprint ? "preprint" : "publication record", doi, pmid: source === "MED" ? id : "", isOpenAccess: item.isOpenAccess === "Y" } }, ["q-bio"])];
  });
  return { events, status: events.length < items.length ? "partial" : "ok" };
}

export async function fetchHuggingFace(load: PublicLoader = fetchPublicText): Promise<Sample> {
  const events: SignalEvent[] = []; let failed = 0;
  for (const kind of ["models", "datasets"] as const) {
    try {
      const items: unknown = JSON.parse((await load(`https://huggingface.co/api/${kind}?sort=lastModified&direction=-1&limit=30&full=true`)).text);
      if (!Array.isArray(items)) throw new Error("Invalid Hub listing");
      // Four documented cards per kind bounds the total to 18 HTTP requests.
      const candidates = items.map(record).filter((item) => !item.private && !item.gated && /^(?:[\w.-]+\/)?[\w.-]+$/.test(text(item.id))
        && (Number(item.downloads) >= 20 || Number(item.likes) >= 1)).slice(0, 4);
      for (const item of candidates) {
        try {
          const id = text(item.id);
          const detail = record(JSON.parse((await load(`https://huggingface.co/api/${kind}/${id}?expand[]=createdAt&expand[]=lastModified&expand[]=cardData&expand[]=downloads&expand[]=tags`, 500_000)).text));
          const root = `https://huggingface.co/${kind === "datasets" ? "datasets/" : ""}${id}`;
          const cardUrl = `${root}/raw/main/README.md`;
          const card = (await load(cardUrl, 120_000)).text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "").trim();
          const createdAt = date(detail.createdAt ?? item.createdAt);
          const updatedAt = date(detail.lastModified ?? item.lastModified);
          const publishedAt=updatedAt ?? createdAt;
          const changeKind=createdAt && updatedAt && Date.parse(updatedAt)-Date.parse(createdAt)>6*3_600_000 ? "update" : "release";
          if (!createdAt || !publishedAt || card.length < 100) continue;
          const license = text(record(detail.cardData).license) || (Array.isArray(detail.tags) ? detail.tags.find((tag) => typeof tag === "string" && tag.startsWith("license:"))?.slice(8) : null);
          const externalId = `${kind}-${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
          events.push(signal("hugging-face", externalId, `${id} — ${kind === "models" ? "model" : "dataset"} ${changeKind}`, root, publishedAt,
            { text: cleanSourceText(card).slice(0, 12000), kind: kind === "models" ? "model-card" : "dataset-card", url: cardUrl,
              attribution: id.split("/")[0], license: license || null, retrievedAt: new Date().toISOString(),
              metadata: { repoId: id, createdAt, updatedAt:updatedAt ?? createdAt, changeKind, dateMeaning:changeKind==="update" ? "Repository update, not original release" : "Repository release", downloads: Number(detail.downloads) || 0 } }, ["cs.AI"]));
        } catch { failed++; }
      }
    } catch { failed++; }
  }
  if (failed && !events.length) throw new Error("Hugging Face cards unavailable");
  return { events, status: failed ? "partial" : "ok" };
}
