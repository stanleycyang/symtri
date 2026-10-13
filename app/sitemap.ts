import type {MetadataRoute} from "next";
import {getUniverseCatalog} from "@/lib/data/catalog";
import {listWeeklyReports} from "@/lib/data/reports";
import {pageEvidence, pointPath} from "@/lib/seo/topics";
import {evidenceIndexable} from "@/lib/seo/content";
export const revalidate = 3600;
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = await getUniverseCatalog();
  const modified = new Map<string,string>();
  const reports=await listWeeklyReports();
  for(const report of reports)modified.set(`/signal/${report.week}`,report.modifiedAt ?? report.publishedAt);
  const topicPaths: string[] = [];
  // Sequential reads preserve the app's single-connection serverless policy.
  // Use the same full-archive evidence query as the landing page, not the map cap.
  for (const region of catalog.topics) {
    for (const child of [null, ...region.children]) {
      const evidence = await pageEvidence(region.id, child?.id ?? null);
      if (evidenceIndexable(evidence.events.length, evidence.unavailable) !== true) continue;
      const path = pointPath(child?.id ?? region.id, catalog)!;
      topicPaths.push(path);
      // Publication dates are not page modification dates; omit an uncertain lastmod.
    }
  }
  const archiveModified = reports.map(report => report.modifiedAt ?? report.publishedAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  if (archiveModified) modified.set("/signal", archiveModified);
  const paths = ["/", "/about", "/signal", ...reports.map(report=>`/signal/${report.week}`), ...topicPaths];
  return paths.map(path => ({url: `https://symtri.com${path}`, ...(modified.has(path) ? {lastModified: modified.get(path)} : {}), changeFrequency: path === "/about" ? "monthly" : "daily", priority: path === "/" ? 1 : .7}));
}
