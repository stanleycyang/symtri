import { createHash } from "node:crypto";
import type { SignalEvent, SourceEvidence } from "./model";
import { ENRICHMENT_VERSION } from "./reading-note-version";

export function normalizedEvidenceText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Preserve case, numbers, provenance and licenses; ignore collection timestamps
// and transport metadata that cannot change the grounded explanation.
export function evidenceFingerprint(body: SourceEvidence): string {
  const url=new URL(body.url);
  for(const key of [...url.searchParams.keys()]) {
    const lower=key.toLowerCase();
    if(lower.startsWith("utm_") || ["ref","ref_src","fbclid","gclid"].includes(lower)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return createHash("sha256").update(JSON.stringify({
    text: normalizedEvidenceText(body.text), kind: body.kind,
    url: url.toString(), attribution: body.attribution, license: body.license,
    dateMeaning:body.metadata?.dateMeaning,
  })).digest("hex");
}

export function noteFingerprint(event: SignalEvent, evidenceSource: string): string {
  return createHash("sha256").update(JSON.stringify({ version: ENRICHMENT_VERSION,
    title: normalizedEvidenceText(event.title), summary: normalizedEvidenceText(event.summary),
    publishedAt:event.publishedAt,
    evidenceSource, evidence: event.evidence ? evidenceFingerprint(event.evidence) : null,
  })).digest("hex");
}

export function evidenceSuitable(event: SignalEvent): boolean {
  const evidence = event.evidence;
  if (!evidence || !evidence.attribution.trim()) return false;
  const minimum = event.source === "europe-pmc" && ["abstract", "preprint"].includes(evidence.kind) ? 100 : 150;
  return normalizedEvidenceText(evidence.text).length >= minimum;
}

export function failurePolicy(code: string, attempt: number): { blocked: boolean; delaySeconds: number } {
  const blocked = ["source-restricted", "source-too-thin", "source-too-large", "source-http-404", "source-http-410",
    "source-http-401", "source-http-403", "model-http-400", "model-http-401", "model-http-402", "model-http-403"].includes(code);
  // Support failures wait longer; temporary transport failures back off across
  // the existing three-attempt ceiling.
  const delaySeconds = /quote-rejected|support-rejected/.test(code) ? 6 * 3600
    : Math.min(6 * 3600, 15 * 60 * 4 ** Math.max(0, attempt - 1));
  return { blocked: blocked || attempt >= 3, delaySeconds };
}
