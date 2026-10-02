import { fetchPublicText } from "./public-fetch";
import type { PublicLoader } from "./extended-sources";
import type { SignalEvent } from "./model";

export type BackgroundContext = {
  kind: "background" | "indicator";
  title: string;
  text: string;
  url: string;
  attribution: string;
  license: string | null;
  retrievedAt: string;
  revision?: number;
  value?: number;
  unit?: string;
  geography?: string;
  period?: string;
};

export const backgroundSubjects: Record<string, string> = {
  ai: "Artificial intelligence", "ai-agents": "Intelligent agent", "ai-coding-agents": "AI coding assistant",
  "ai-language-models": "Large language model", software: "Software engineering", science: "Scientific method",
  "science-biotechnology": "Biotechnology", "science-neuroscience": "Neuroscience", "science-climate-science": "Climate change",
  space: "Astronomy", "space-astronomy": "Astronomy", energy: "Energy transition", "energy-nuclear": "Nuclear power",
  "energy-fusion": "Fusion power", "energy-battery-storage": "Rechargeable battery", "energy-solar": "Solar power",
  markets: "Economics", security: "Computer security", hardware: "Computer hardware", "hardware-semiconductors":"Semiconductor", startups: "Startup company", crypto: "Cryptocurrency",
};

export function backgroundSubjectFor(event:Pick<SignalEvent,"title"|"summary"|"topics">):string|undefined {
  const text=`${event.title} ${event.summary}`;
  if(/\b(?:glaciers?|greenland|ice sheets?|glaciology)\b/i.test(text)) return "Glaciology";
  if(/\bMars\b/i.test(text) && /\b(?:missions?|orbiter|martian|exploration|satellites?)\b/i.test(text)) return "Mars";
  if(/\bexoplanets?\b/i.test(text)) return "Exoplanet";
  const match=event.topics[0];
  return backgroundSubjects[match?.subtopicId ?? ""] ?? backgroundSubjects[match?.topicId ?? ""];
}

export async function fetchWikipedia(title: string, load: PublicLoader = fetchPublicText): Promise<BackgroundContext> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  for (const [key,value] of Object.entries({action:"query",format:"json",formatversion:"2",titles:title,prop:"extracts|revisions",exintro:"1",explaintext:"1",exchars:"1200",rvprop:"ids",redirects:"1",meta:"siteinfo",siprop:"rightsinfo"})) url.searchParams.set(key,value);
  const data = JSON.parse((await load(url.toString(), 300_000)).text);
  const page = data.query?.pages?.[0];
  if (typeof page?.extract !== "string" || typeof page.title !== "string" || !Number.isInteger(page.pageid) || !Number.isInteger(page.revisions?.[0]?.revid) || page.missing || page.title?.includes("(disambiguation)")) throw new Error("No unambiguous background explanation");
  return {kind:"background",title:page.title,text:page.extract.slice(0,1200),url:`https://en.wikipedia.org/w/index.php?curid=${page.pageid}&oldid=${page.revisions?.[0]?.revid}`,
    attribution:"Wikipedia contributors",license:data.query?.rightsinfo?.text || null,revision:page.revisions?.[0]?.revid,retrievedAt:new Date().toISOString()};
}

export const indicatorSpecs = {
  renewable: {id:"EG.ELC.RNEW.ZS",title:"Renewable electricity share",unit:"% of total electricity output"},
  growth: {id:"NY.GDP.MKTP.KD.ZG",title:"GDP growth",unit:"annual %"},
} as const;

export async function fetchWorldBank(key: keyof typeof indicatorSpecs, load: PublicLoader = fetchPublicText): Promise<BackgroundContext[]> {
  const spec = indicatorSpecs[key];
  const url = `https://api.worldbank.org/v2/country/WLD;USA/indicator/${spec.id}?format=json&per_page=100&date=${new Date().getUTCFullYear()-8}:${new Date().getUTCFullYear()}`;
  const data = JSON.parse((await load(url,300_000)).text);
  if (!Array.isArray(data?.[1])) throw new Error("Invalid indicator response");
  const found = new Map<string, BackgroundContext>();
  for (const row of data[1].filter((row: {date?:unknown}|null) => row && typeof row.date === "string").sort((a: {date:string}, b:{date:string})=>b.date.localeCompare(a.date))) {
    if (typeof row.date !== "string" || !/^\d{4}$/.test(row.date) || row.indicator?.id !== spec.id || !["WLD", "USA"].includes(row.countryiso3code)) continue;
    if (typeof row.value !== "number" || !Number.isFinite(row.value) || !row.country?.value || found.has(row.country.value)) continue;
    const context: BackgroundContext = {kind:"indicator",title:spec.title,text:`${row.country.value}: ${row.value.toFixed(2)} ${spec.unit} (${row.date}).`,value:row.value,unit:spec.unit,geography:row.country.value,period:row.date,
      url:`https://data.worldbank.org/indicator/${spec.id}`,attribution:"World Bank World Development Indicators",license:"CC BY 4.0",retrievedAt:new Date().toISOString()};
    found.set(row.country.value,context);
  }
  if (!found.size) throw new Error("No reported indicator values");
  return [...found.values()];
}
