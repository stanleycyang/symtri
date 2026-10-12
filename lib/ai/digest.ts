import {summarizeAnswer} from "./summarize";
import {gatewayConfigured} from "./gateway";
import {awaitWithinDeadline} from "./deadline";
import type {AskResult} from "./ask";
import type {WeeklyDigest} from "../data/digest";
export async function digestIntro(digest: WeeklyDigest, summarize: typeof summarizeAnswer = summarizeAnswer, configured = gatewayConfigured()): Promise<string | undefined> {
 if (!configured || !digest.signals.length) return undefined;
 const deadline = AbortSignal.timeout(15_000);
 const answer: AskResult = {question:"What are two concise, source-grounded takeaways from these selected weekly signals? Preserve attribution and uncertainty.",summary:"",regionIds:[],pathIds:[],pathSteps:[],subtopicId:null,evidenceCount:digest.signals.length,observedAt:digest.end,scope:"history",retrieval:"terms",summaryKind:"sample",citedEventIds:[],events:digest.signals.map(({id,source,title,url,publishedAt})=>({id,source,title,url,publishedAt}))};
 try {
  const result=await awaitWithinDeadline(summarize(answer,{observedAt:digest.end,events:digest.signals,sources:{},partial:false,scope:"history"},undefined,undefined,deadline),deadline);
  if (!result.citedEventIds.length || result.citedEventIds.some(id=>!digest.signals.some(event=>event.id===id))) return undefined;
  return result.summary;
 } catch {return undefined;}
}
