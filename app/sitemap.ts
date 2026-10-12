import type {MetadataRoute} from "next";
import {getUniverseCatalog} from "@/lib/data/catalog";
import {pageFeed, pointPath} from "@/lib/seo/topics";
export const revalidate = 3600;
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = await getUniverseCatalog();
  const feed = await pageFeed();
  const modified = new Map<string,string>();
  for (const event of feed?.events ?? []) for(const match of event.topics) for(const id of [match.topicId,match.subtopicId].filter(Boolean) as string[]) {const path=pointPath(id,catalog);if(path && (!modified.has(path) || modified.get(path)! < event.publishedAt))modified.set(path,event.publishedAt);}
  const paths = ["/", "/about", ...catalog.topics.flatMap(region => [pointPath(region.id, catalog)!, ...region.children.map(child => pointPath(child.id, catalog)!)])];
  return paths.map(path => ({url: `https://symtri.com${path}`, ...(modified.has(path) ? {lastModified: modified.get(path)} : {}), changeFrequency: path === "/about" ? "monthly" : "daily", priority: path === "/" ? 1 : .7}));
}
