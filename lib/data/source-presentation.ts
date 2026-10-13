import type { SourceEvidence } from "./model";

export const sourceKindLabels:Readonly<Record<SourceEvidence["kind"],string>>={
  abstract:"RESEARCH",preprint:"PREPRINT",feed:"ARTICLE",advisory:"ADVISORY",
  "model-card":"MODEL CARD","dataset-card":"DATASET CARD",repository:"REPOSITORY",article:"ARTICLE",discussion:"DISCUSSION",
};

const dateOnlySources=new Set(["openalex","europe-pmc","cisa"]);

/** These adapters supply publication/catalog dates without a time of day. */
export function sourceHasDayPrecision(source:string):boolean {
  return dateOnlySources.has(source);
}

/** Match the adapter's timestamp meaning rather than calling every date publication. */
export function sourceDatePresentation(source: string): {label: string; schemaProperty: "datePublished" | "dateCreated" | "dateModified" | null} {
  if (source === "github") return {label: "Repository created", schemaProperty: "dateCreated"};
  if (source === "hugging-face") return {label: "Model / dataset date", schemaProperty: "dateModified"};
  if (source === "cisa") return {label: "Added to KEV", schemaProperty: null};
  if (source === "hacker-news") return {label: "Posted on Hacker News", schemaProperty: null};
  if (["arxiv", "openalex", "europe-pmc"].includes(source)) return {label: "Published", schemaProperty: "datePublished"};
  return {label: "Source date", schemaProperty: null};
}
