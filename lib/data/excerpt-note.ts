import type {ReadingNote} from "./enrichment";
import {extractivePassage} from "./note-presentation";
import {hasExcerptChrome,sourcePassage} from "./source-passage";
export function needsExcerptRepair(note: ReadingNote): boolean {
 const quote=extractivePassage(note.explanation);
 return quote!==null && (hasExcerptChrome(quote) || sourcePassage(quote,"",note.sourceKind)===null);
}
/** Repair the response, not saved evidence or its exact historical quotations. */
export function readableExcerptNote(note: ReadingNote, title: string, retainedText?: string): ReadingNote {
 if(!needsExcerptRepair(note))return note;
 const original=extractivePassage(note.explanation) ?? "";
 const quote=sourcePassage(retainedText ?? original,title,note.sourceKind);
 if(!quote)return {...note,synthesisMethod:"extractive",explanation:"",claims:[]};
 const label=note.sourceKind==="discussion" ? "discussion" : "source";
 const explanation=`The ${label} states: “${quote}”`;
 const sourceId=note.claims[0]?.evidence[0]?.sourceId;
 return {...note,synthesisMethod:"extractive",explanation,claims:sourceId ? [{text:explanation,kind:"fact",evidence:[{sourceId,quote}]}] : []};
}
