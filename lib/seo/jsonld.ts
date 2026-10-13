export const siteUrl = "https://symtri.com";
export const creator = { "@type": "Person", name: "Stanley Yang", url: "https://stanleycyang.com", sameAs: ["https://stanleycyang.com"] };
export function serializeJsonLd(data: unknown): string { return JSON.stringify(data).replace(/</g, "\\u003c"); }
export function websiteSchema() { return { "@context": "https://schema.org", "@type": "WebSite", name: "SYMTRI", url: siteUrl, creator }; }
export function datasetSchema(name: string, description: string, path: string, start?: string, end?: string, count?: number, momentum?: string) {
  return { "@context": "https://schema.org", "@type": "Dataset", name: `${name} signals`, description: `${description} SYMTRI classification metadata is MIT licensed; linked third-party source content retains its original rights.`, url: siteUrl + path, creator,
    license: "https://github.com/stanleycyang/symtri/blob/main/LICENSE", isAccessibleForFree: true,
    ...(count !== undefined ? {variableMeasured:[{"@type":"PropertyValue",name:"Observations in the fourteen-day window",value:count},...(momentum ? [{"@type":"PropertyValue",name:"Region momentum",value:momentum}] : [])]} : {}),
    ...(start && end ? { temporalCoverage: `${start}/${end}` } : {}) };
}
export function breadcrumbSchema(items: {name: string; path: string}[]) { return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: siteUrl + item.path })) }; }
