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
