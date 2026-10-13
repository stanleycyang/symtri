import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { getUniverseCatalog } from "@/lib/data/catalog";
import { getPersistedCurrentFeed, getTopicPage } from "@/lib/data/storage";
import type { Metadata } from "next";
import {pointPath,topicSlug as childSlug} from "./paths";
import {subjectContent, evidenceIndexable} from "./content";
import {parseTopicCursor} from "../data/topic-cursor";
export {pointPath} from "./paths";
export const resolvePage = cache(async (regionSlug: string, topicSlug?: string) => {
  const catalog = await getUniverseCatalog();
  const sourceRegion = catalog.topics.find(item => item.id === regionSlug);
  const requested = topicSlug ? sourceRegion?.children.find(child => childSlug(regionSlug,child.id) === topicSlug)?.id
    ?? (catalog.redirects?.[topicSlug] ? topicSlug : `${regionSlug}-${topicSlug}`) : regionSlug;
  let id = requested;
  for (let i = 0; i < 8 && catalog.redirects?.[id]; i++) id = catalog.redirects[id];
  const path = pointPath(id, catalog);
  if (id !== requested && path) permanentRedirect(path);
  const region = catalog.topics.find(item => item.id === regionSlug);
  const child = topicSlug ? region?.children.find(item => item.id === id) : undefined;
  if (!region || (topicSlug && !child)) notFound();
  const name = child?.name ?? region.name;
  const content = subjectContent(region.id, region.name, name, child?.id);
  return {catalog, region, child, name, ...content, path: path!, id};
});
export const pageEvidence = cache(async (regionId: string, childId: string | null, cursor: string | null = null) => {
  if (cursor && !parseTopicCursor(cursor)) notFound();
  if (!process.env.DATABASE_URL) return {events: [], nextCursor: null, unavailable: false};
  try { return {...await getTopicPage(regionId, childId, cursor, 10, true), unavailable: false}; }
  catch (error) {
    if (error instanceof Error && error.message === "Invalid topic cursor") notFound();
    return {events: [], nextCursor: null, unavailable: true};
  }
});
export async function topicMetadata(region: string, topic?: string, cursor: string | null = null): Promise<Metadata> {
  const page = await resolvePage(region, topic);
  const evidence = await pageEvidence(page.region.id, page.child?.id ?? null, cursor);
  const indexable = evidenceIndexable(evidence.events.length, evidence.unavailable);
  const title = `${page.subject} research and developments | SYMTRI`;
  const path = cursor ? `${page.path}/sources/${encodeURIComponent(cursor)}` : page.path;
  const image = `/api/og?point=${encodeURIComponent(page.id)}&v=2`;
  return {title: cursor ? `Earlier sources: ${title}` : title, description: page.description, alternates: {canonical: path},
    ...(cursor || indexable === false ? {robots: {index: false, follow: true}} : {}),
    openGraph: {title, description: page.description, url: path, siteName: "SYMTRI", type: "website", images: [{url: image, width: 1200, height: 630, alt: `${page.name} sources and activity in SYMTRI`}]},
    twitter: {card: "summary_large_image", title, description: page.description, images: [image]}};
}

export const pageFeed = cache(async () => {
  if(!process.env.DATABASE_URL)return null;
  try {
    const feed=await getPersistedCurrentFeed();
    if(!feed)return null;
    // SEO pages revalidate hourly. Reuse the full-window ingestion statistics;
    // rebuilding readiness across the archive for every page overloads builds.
    const stale=Date.now()-Date.parse(feed.observedAt)>3*60*60*1000;
    return stale ? {...feed,activity:undefined,childCounts:undefined,publishedEvidence:undefined} : feed;
  } catch {return null;}
});
