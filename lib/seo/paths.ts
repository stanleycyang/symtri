import {seedCatalog, type UniverseCatalog} from "../universe";
export function topicSlug(regionId: string, childId: string): string {
 const prefix = `${regionId}-`;
 return childId.startsWith(prefix) ? childId.slice(prefix.length) : childId;
}
export function pointPath(id: string, catalog: UniverseCatalog = seedCatalog): string | null {
 for (const region of catalog.topics) {
  if (region.id === id) return `/${id}`;
  if (region.children.some(child => child.id === id)) return `/${region.id}/${topicSlug(region.id,id)}`;
 }
 return null;
}
