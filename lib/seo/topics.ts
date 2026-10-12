import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { getUniverseCatalog } from "@/lib/data/catalog";
import {getCurrentFeed} from "@/lib/data/current";
import { getTopicPage } from "@/lib/data/storage";
import type { Metadata } from "next";
import {pointPath,topicSlug as childSlug} from "./paths";
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
  const description = `Follow recent ${name.toLowerCase()} research, projects, and news in SYMTRI. Explore original sources and how these ideas connect across technology.`;
  return {catalog, region, child, name, description, path: path!, id};
});
export const pageEvidence = cache(async (regionId: string, childId: string | null) => {
  if (!process.env.DATABASE_URL) return {events: [], unavailable: false};
  try { return {events: (await getTopicPage(regionId, childId, null, 10, true)).events, unavailable: false}; }
  catch { return {events: [], unavailable: true}; }
});
export async function topicMetadata(region: string, topic?: string): Promise<Metadata> {
  const page = await resolvePage(region, topic);
  const title = `${page.name} — what tech is paying attention to | SYMTRI`;
  const image = `/api/og?point=${encodeURIComponent(page.id)}`;
  return {title, description: page.description, alternates: {canonical: page.path},
    openGraph: {title, description: page.description, url: page.path, images: [{url: image, width: 1200, height: 630}]},
    twitter: {card: "summary_large_image", title, description: page.description, images: [image]}};
}

export const pageFeed = cache(async () => {
  try {return await getCurrentFeed(true);} catch {return null;}
});
