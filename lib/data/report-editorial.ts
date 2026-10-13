import {canonicalSignalUrl} from "./identity";
import {selectDistinctHeadlines} from "./select";
import type {SignalEvent, SourceEvidence} from "./model";
import type {ReadingNote} from "./enrichment";
import type {GroundedClaim} from "../ai/summarize";

export const REPORT_VERSION = 2;
export type ReportCandidate = {event: SignalEvent; note: ReadingNote; evidence: SourceEvidence};
export type ReportBrief = {
  id: string;
  mapPath?: string;
  title: string;
  audience: string;
  whatChanged: GroundedClaim;
  whyMatters: GroundedClaim | null;
  limitation: GroundedClaim | null;
  nextStep: string;
  question: string;
  sources: (Pick<SignalEvent, "id" | "title" | "url" | "source" | "publishedAt"> & {kind: SourceEvidence["kind"]; attribution: string})[];
  method: "model" | "reading-note";
};
export type ReportEditorial = {
  version: number;
  briefs: ReportBrief[];
  watch: ReportBrief | null;
  archiveCount: number;
  readyCount: number;
  sourceCount: number;
};

const usefulEvidence = (candidate: ReportCandidate) => candidate.evidence.kind !== "discussion"
  && candidate.note.claims.some(claim => claim.kind === "fact" || !claim.kind);

/** Evidence and breadth come before the capped, within-source engagement score. */
export function selectReportCandidates(candidates: ReportCandidate[], limit = 4, orderedIds: string[] = []): ReportCandidate[] {
  const rank=new Map(orderedIds.map((id,index)=>[id,index]));
  const ranked = candidates.filter(usefulEvidence).sort((a, b) =>
    (rank.get(a.event.id) ?? 1000) - (rank.get(b.event.id) ?? 1000)
    || Number(b.note.synthesisMethod === "model") - Number(a.note.synthesisMethod === "model")
    || Number(b.note.claims.some(claim => claim.kind === "implication")) - Number(a.note.claims.some(claim => claim.kind === "implication"))
    || Math.min(30, b.event.importance) - Math.min(30, a.event.importance)
    || b.event.publishedAt.localeCompare(a.event.publishedAt)
    || a.event.id.localeCompare(b.event.id));
  const chosen: ReportCandidate[] = [];
  const urls = new Set<string>();
  while (chosen.length < limit) {
    const options = ranked.filter(candidate => !chosen.includes(candidate) && !urls.has(canonicalSignalUrl(candidate.event.url))
      && selectDistinctHeadlines([candidate.event], 1, chosen.map(item => item.event.title)).length);
    options.sort((a, b) => {
      const novelty = (candidate: ReportCandidate) =>
        Number(!chosen.some(item => item.event.source === candidate.event.source)) * 3
        + Number(!chosen.some(item => item.event.topics[0]?.topicId === candidate.event.topics[0]?.topicId)) * 2;
      return (rank.get(a.event.id) ?? 1000) - (rank.get(b.event.id) ?? 1000) || novelty(b) - novelty(a);
    });
    if (!options.length) break;
    chosen.push(options[0]);
    urls.add(canonicalSignalUrl(options[0].event.url));
  }
  return chosen;
}

export function scopeReportFinding(claim:GroundedClaim,kind:SourceEvidence["kind"]):GroundedClaim {
  if(["preprint","abstract"].includes(kind) && !/^(?:the )?(?:authors?|researchers?|study|preprint|paper)\b/i.test(claim.text)) {
    return {...claim,text:`The ${kind==="preprint" ? "preprint" : "study"} authors report: ${claim.text}`};
  }
  if(["repository","model-card","dataset-card"].includes(kind) && !/^(?:the )?(?:authors?|maintainers?|documentation|model card|dataset card)\b/i.test(claim.text)) {
    return {...claim,text:`The maintainers describe: ${claim.text}`};
  }
  return claim;
}

export function briefFromReadingNote(candidate: ReportCandidate): ReportBrief {
  const {event, note, evidence} = candidate;
  const fact = note.claims.find(claim => claim.kind === "fact" || !claim.kind)!;
  const title=event.title.replace(/[?!.]+$/,"");
  const question = note.questions.find(item => item.trim().length >= 10 && !/^What does this source establish about/i.test(item))
    ?? `Which claims in “${title.slice(0,150)}” are supported, and what evidence is still missing?`;
  const audiences:Record<string,string>={ai:"People building or evaluating AI systems",software:"Developers evaluating tools and workflows",hardware:"Engineers evaluating computing hardware",security:"Engineers reviewing security and privacy risks",science:"Researchers evaluating methods and evidence",energy:"Engineers evaluating energy technologies",space:"Researchers and engineers working with space data",markets:"Readers assessing technology market claims",startups:"Product teams evaluating new tools",cloud:"Engineers evaluating cloud infrastructure"};
  return {
    id: event.id, title: event.title, audience: audiences[event.topics[0]?.topicId] ?? "People evaluating this work",
    whatChanged: scopeReportFinding(fact ?? note.claims[0],evidence.kind),
    whyMatters: note.claims.find(claim => claim.kind === "implication") ?? null,
    limitation: note.claims.find(claim => claim.kind === "limitation") ?? null,
    nextStep: `Compare the ${["preprint", "abstract"].includes(evidence.kind) ? "study’s reported findings and evaluation conditions" : evidence.kind === "repository" ? "project’s documented capabilities" : "source’s claims"} with the evidence it presents. Use the question below to check what remains untested before applying the findings.`,
    question, sources: [{id:event.id,title:event.title,url:evidence.url,source:note.evidenceSource || event.source,
      publishedAt:event.publishedAt,kind:evidence.kind,attribution:evidence.attribution}], method:"reading-note",
  };
}

export function evidenceCaveat(kind: SourceEvidence["kind"]): string {
  if (kind === "preprint") return "A preprint reports the authors’ findings; peer review and independent replication are not established here.";
  if (kind === "abstract") return "This brief is grounded in an abstract, which may omit methods and important limitations.";
  if (["repository", "model-card", "dataset-card"].includes(kind)) return "Capabilities described by the maintainers are not an independent evaluation.";
  if (kind === "discussion") return "Discussion statements are attributed opinions or reports, not independently verified findings.";
  return "This brief describes the cited source; independent corroboration is not established here.";
}
