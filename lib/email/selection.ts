import type {ReportCandidate} from '../data/report-editorial';

/** Newsletter selection is stricter than map membership: readers need relevant findings. */
export function usefulNodeCandidate(candidate:ReportCandidate,nodeId:string):boolean {
 const text=candidate.note.claims.map(claim=>claim.text).join(' ');
 if(/\b(?:kind\s*:\s*(?:fact|implication)|evidence\s*:\s*\[)/i.test(text))return false;
 if(candidate.evidence.kind==='repository' && /(?:wallet.?drainer|solana.?drainer|fake.?balance)/i.test(candidate.event.title))return false;
 // These names have common meanings outside the subject promised by the node.
 const subject=`${candidate.event.title} ${text}`;
 if(nodeId==='energy-fusion')return /\b(?:nuclear|thermonuclear|tokamak|stellarator|plasma|deuterium|tritium)\b/i.test(subject);
 if(nodeId==='energy-nuclear')return /\b(?:reactor|fission|fuel cycle|critical mass|power plant|nuclear (?:energy|power|fuel))\b/i.test(subject);
 if(nodeId==='crypto-ethereum')return /\b(?:ethereum|ether|evm|solidity)\b/i.test(subject);
 return true;
}
