import { createHash, randomUUID } from "node:crypto";
import { database, getArchivedSignal, getSignalEvidence, persistSourceEvidence } from "./storage";
import { fetchPublicText } from "./public-fetch";
import { cleanSourceText } from "./normalize";
import { backgroundSubjectFor, fetchWikipedia, fetchWorldBank, type BackgroundContext } from "./background";
import { gatewayConfigured } from "../ai/gateway";
import { answerKnowledgeQuestion } from "../ai/ask";
import { summarizeReadingNote, type GroundedClaim } from "../ai/summarize";
import { unavailableSources, type SignalEvent } from "./model";

export const ENRICHMENT_VERSION = 5;
export type ReadingNote = { explanation: string; claims: GroundedClaim[]; questions: string[]; createdAt: string; sourceKind: string; evidenceSource: string; evidenceUrl: string; evidenceAttribution: string; evidenceLicense: string|null; context: BackgroundContext[] };

export function readingNoteFailureCode(stage: "evidence" | "hydrate" | "generate" | "context" | "commit", error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/timeout|abort/i.test(message) || error instanceof Error && /AbortError|TimeoutError/.test(error.name)) return `${stage}-timeout`;
  if (stage === "evidence") {
    const status = /\bHTTP (\d{3})\b/.exec(message)?.[1];
    if (status) return `source-http-${status}`;
    if (/restricts extraction/i.test(message)) return "source-restricted";
    if (/Insufficient|Awaiting retained|No repository README|No public release notes/i.test(message)) return "source-too-thin";
    if (/too large/i.test(message)) return "source-too-large";
    return "source-fetch-error";
  }
  if (stage === "generate") {
    if (/valid source passage|quantity lacked quoted support/i.test(message)) return "quote-rejected";
    if (/supported claim|support audit|direct evidence/i.test(message)) return "support-rejected";
    const status = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : NaN;
    if (Number.isInteger(status)) return `model-http-${status}`;
    return "model-error";
  }
  return `${stage}-error`;
}

export async function claimReadingNoteWorker(lane: number, runId: string): Promise<boolean> {
  const rows = await database()`insert into reading_note_workers(lane,run_id,lease_until)
    values(${lane},${runId},now()+interval '15 minutes')
    on conflict(lane) do update set run_id=excluded.run_id,lease_until=excluded.lease_until,updated_at=now()
    where reading_note_workers.lease_until<=now() and reading_note_workers.run_id<>excluded.run_id returning lane`;
  return rows.length === 1;
}

export async function renewReadingNoteWorker(lane: number, runId: string): Promise<boolean> {
  const rows = await database()`update reading_note_workers set lease_until=now()+interval '15 minutes',updated_at=now()
    where lane=${lane} and run_id=${runId} and lease_until>now() returning lane`;
  return rows.length === 1;
}

export async function releaseReadingNoteWorker(lane: number, runId: string): Promise<void> {
  await database()`update reading_note_workers set lease_until=now(),updated_at=now()
    where lane=${lane} and run_id=${runId}`;
}

export async function enqueueMissingNotes(limit = 200): Promise<number> {
  const rows = await database()`insert into reading_notes(signal_id)
    select event.id from signal_events event where not exists(select 1 from reading_notes note where note.signal_id=event.id)
      and exists(select 1 from signal_observations observation join source_catalog source on source.id=observation.source and source.status='active' where observation.signal_id=event.id)
    order by event.first_seen_at desc limit ${limit} on conflict do nothing returning signal_id`;
  const sql=database();
  const refreshed=await sql`with stale as(select note.signal_id from reading_notes note
      where note.version<>${ENRICHMENT_VERSION}
        or (note.status='ready' and note.note->>'evidenceSource' is not null
          and not exists(select 1 from source_catalog source where source.id=note.note->>'evidenceSource' and source.status='active')
          and exists(select 1 from signal_observations observation join source_catalog source on source.id=observation.source and source.status='active' where observation.signal_id=note.signal_id))
      order by case when note.status='ready' then 0 else 1 end,note.updated_at limit ${limit})
    update reading_notes note set version=${ENRICHMENT_VERSION},status='pending',note=null,input_hash=null,attempts=0,retry_at=now(),lease_until=null,failure_code=null,revision=revision+1,updated_at=now()
    from stale where note.signal_id=stale.signal_id returning note.signal_id`;
  return rows.length+refreshed.length;
}

export function evidenceHash(event: SignalEvent): string {
  return createHash("sha256").update(JSON.stringify({version:ENRICHMENT_VERSION,title:event.title,summary:event.summary,
    evidence:event.evidence ? {...event.evidence,retrievedAt:undefined}:null})).digest("hex");
}

export async function getCachedContext(key: string): Promise<BackgroundContext[] | null> {
  const rows = await database()<{body:BackgroundContext[]}[]>`select body from background_context where key=${key} and expires_at>now()`;
  return rows[0]?.body ?? null;
}

async function contextFor(event: SignalEvent): Promise<BackgroundContext[]> {
  const match = event.topics[0];
  const title = backgroundSubjectFor(event);
  const result: BackgroundContext[] = [];
  const requests: {key:string;load:()=>Promise<BackgroundContext[]>}[] = [];
  if (title) requests.push({key:`wiki:${title}`,load:async()=>[await fetchWikipedia(title)]});
  if (match?.topicId === "energy") requests.push({key:"indicator:renewable",load:()=>fetchWorldBank("renewable")});
  if (match?.topicId === "markets") requests.push({key:"indicator:growth",load:()=>fetchWorldBank("growth")});
  for (const request of requests) {
    const cached = await getCachedContext(request.key);
    if (cached) {result.push(...cached);continue;}
    try {
      const body = await request.load();
      const sql=database();
      await sql`insert into background_context(key,body,expires_at) values(${request.key},${sql.json(body)},now()+interval '7 days')
        on conflict(key) do update set body=excluded.body,expires_at=excluded.expires_at,updated_at=now()`;
      result.push(...body);
    } catch {
      // Cache failed lookups briefly so a provider failure does not multiply requests.
      const sql=database();
      await sql`insert into background_context(key,body,expires_at) values(${request.key},${sql.json([])},now()+interval '6 hours')
        on conflict(key) do update set body=excluded.body,expires_at=excluded.expires_at,updated_at=now()`;
    }
  }
  return result;
}

export function archivedAbstractEvidence(event: SignalEvent): SignalEvent["evidence"] | null {
  if (event.source !== "arxiv" && event.source !== "openalex") return null;
  // These two adapters store an excerpt of the source abstract in summary.
  // Older observations predate signal_evidence; their archived excerpt is still
  // source text and can ground a note without scraping a publisher's DOI page.
  const excerpt = cleanSourceText(event.summary).replace(/…$/, "").trim();
  if (excerpt.length < 150) return null;
  return { text: excerpt, kind: event.source === "arxiv" ? "preprint" : "abstract",
    url: event.url, attribution: event.source === "arxiv" ? "arXiv authors" : "Publication authors via OpenAlex",
    license: null, retrievedAt: new Date().toISOString(), metadata: { archivedExcerpt: true } };
}

export async function hackerNewsDiscussionEvidence(event: SignalEvent, load: typeof fetchPublicText = fetchPublicText): Promise<NonNullable<SignalEvent["evidence"]>> {
  if (event.source !== "hacker-news" || !/^\d+$/.test(event.externalId)) throw new Error("Invalid Hacker News story ID");
  const discussionUrl = `https://news.ycombinator.com/item?id=${event.externalId}`;
  const itemUrl = `https://hacker-news.firebaseio.com/v0/item/${event.externalId}.json`;
  const item: unknown = JSON.parse((await load(itemUrl, 200_000)).text);
  if (!item || typeof item !== "object" || Array.isArray(item) || (item as {type?:unknown}).type !== "story") throw new Error("Hacker News story unavailable");
  const story = item as {text?:unknown;kids?:unknown;by?:unknown};
  const ownText = cleanSourceText(story.text);
  const passages: string[] = [];
  if (ownText.length >= 150) passages.push(`Story by ${typeof story.by === "string" ? story.by : "Hacker News user"}: ${ownText}`);
  if (!passages.length && Array.isArray(story.kids)) {
    const ids=story.kids.slice(0,6).filter((id):id is number=>Number.isInteger(id) && id>0);
    const comments=await Promise.allSettled(ids.map(async id=>JSON.parse((await load(`https://hacker-news.firebaseio.com/v0/item/${id}.json`,100_000)).text) as unknown));
    for (const result of comments) {
      if (result.status!=="fulfilled" || !result.value || typeof result.value!=="object" || Array.isArray(result.value)) continue;
      const comment=result.value as {type?:unknown;deleted?:unknown;dead?:unknown;text?:unknown;by?:unknown};
      const content=cleanSourceText(comment.text);
      if (comment.type==="comment" && !comment.dead && !comment.deleted && content.length>=40)
        passages.push(`Comment by ${typeof comment.by==="string" ? comment.by : "Hacker News user"}: ${content}`);
    }
  }
  const text = passages.join(" ").slice(0, 8000);
  if (text.length < 150) throw new Error("Insufficient Hacker News discussion text");
  return { text, kind: "discussion", url: discussionUrl, attribution: passages.length === 1 && ownText.length >= 150 ? "Hacker News post author" : "Hacker News commenters", license: null, retrievedAt: new Date().toISOString() };
}

export async function retrieveStoryEvidence(event: SignalEvent, load:typeof fetchPublicText=fetchPublicText): Promise<SignalEvent> {
  const existing = await getSignalEvidence(event.id);
  const retained = existing[0]?.body;
  const minimum = event.source === "europe-pmc" && (retained?.kind === "abstract" || retained?.kind === "preprint") ? 100 : 150;
  if (retained && retained.text.length >= minimum) return {...event,evidence:retained};
  const archived = archivedAbstractEvidence(event);
  if (archived) {
    const enriched = { ...event, evidence: archived };
    await persistSourceEvidence([enriched]);
    return enriched;
  }
  const url=new URL(event.url);
  if (event.source === "arxiv" && /^(?:www\.)?arxiv\.org$/.test(url.hostname)) {
    const page = await load(event.url, 600_000);
    const abstract = /<meta\s+name=["']citation_abstract["']\s+content=["']([^"']+)["']/i.exec(page.text)?.[1];
    const text = cleanSourceText(abstract).slice(0, 12000);
    if (text.length < 150) throw new Error("Insufficient arXiv abstract text");
    const enriched: SignalEvent = { ...event, evidence: { text, kind: "preprint", url: event.url,
      attribution: "arXiv authors", license: null, retrievedAt: new Date().toISOString() } };
    await persistSourceEvidence([enriched]);
    return enriched;
  }
  let content=""; let kind="article" as NonNullable<SignalEvent["evidence"]>["kind"]; let evidenceUrl=event.url;
  let metadata:Record<string,string|number|boolean>|undefined;
  let attribution=url.hostname;
  let evidence: NonNullable<SignalEvent["evidence"]>;
  const githubRepo=/^\/([\w.-]+)\/([\w.-]+)(?:\/|$)/.exec(url.pathname);
  try { if (url.hostname === "github.com" && githubRepo) {
    const repo=`${githubRepo[1]}/${githubRepo[2]}`;
    const release=/^\/[\w.-]+\/[\w.-]+\/releases\/tag\/(.+)$/.exec(url.pathname);
    if (release) {
      const tag=decodeURIComponent(release[1]);
      const published=JSON.parse((await load(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,300_000)).text);
      if(typeof published.body!=="string" || published.draft===true) throw new Error("No public release notes");
      content=published.body;
      evidenceUrl=typeof published.html_url==="string" && published.html_url.startsWith("https://github.com/") ? published.html_url : event.url;
      metadata={contentType:"release notes",releaseTag:tag,releasePublishedAt:typeof published.published_at==="string"?published.published_at:""};
    } else {
      // Resolve repository links through the actual default-branch README.
      const readme=JSON.parse((await load(`https://api.github.com/repos/${repo}/readme`,300_000)).text);
      if (readme.encoding!=="base64" || typeof readme.content!=="string") throw new Error("No repository README");
      content=Buffer.from(readme.content,"base64").toString("utf8");
      evidenceUrl=typeof readme.html_url==="string" && readme.html_url.startsWith("https://github.com/") ? readme.html_url : event.url;
    }
    kind="repository";attribution=`${repo} maintainers`;
  } else if (/^(?:www\.)?arxiv\.org$/.test(url.hostname)) {
    throw new Error("Awaiting retained abstract from source ingestion");
  } else {
    const page=await load(event.url,600_000);
    // Do not extract pages with an explicit crawler/republication restriction.
    if (/<meta[^>]+(?:robots|googlebot)[^>]+(?:noai|nosnippet|noindex)/i.test(page.text)) throw new Error("Publisher restricts extraction");
    content=page.text.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,"");
    content=/<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(content)?.[1] ?? /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(content)?.[1] ?? "";
  }
  const cleaned=cleanSourceText(content).slice(0,12000);
  if (cleaned.length<150) throw new Error("Insufficient source text");
  evidence={text:cleaned,kind,url:evidenceUrl,attribution,license:null,retrievedAt:new Date().toISOString(),...(metadata?{metadata}:{})};
  } catch (error) {
    if (event.source !== "hacker-news") throw error;
    evidence = await hackerNewsDiscussionEvidence(event, load);
  }
  const enriched = { ...event, evidence };
  await persistSourceEvidence([enriched]);
  return enriched;
}

export async function getReadingNote(id: string): Promise<{status:string;note:ReadingNote|null}|null> {
  const rows=await database()<{status:string;version:number;note:ReadingNote|null;title:string;summary:string;topics:SignalEvent["topics"]}[]>`select note.status,note.version,event.title,event.summary,event.topics,case when note.status='ready' and note.version=${ENRICHMENT_VERSION} then note.note else null end as note from reading_notes note join signal_events event on event.id=note.signal_id
    where note.signal_id=${id} and (note.status <> 'ready' or exists(select 1 from source_catalog where id=note.note->>'evidenceSource' and status='active')) and exists(select 1 from signal_observations observation join source_catalog source on source.id=observation.source and source.status='active' where observation.signal_id=${id})`;
  const row=rows[0];
  if(!row) return null;
  const expected=backgroundSubjectFor(row);
  return {status:row.version!==ENRICHMENT_VERSION || row.status==="ready" && !row.note ? "pending" : row.status,note:row.note?{...row.note,context:row.note.context.filter(context=>context.kind!=="background" || context.title===expected)}:null};
}

export async function enrichBatch(limit=5, synthesize:typeof summarizeReadingNote=summarizeReadingNote, loadContext:typeof contextFor=contextFor, preferRetries=false, preferOldest=false): Promise<{processed:number;ready:number;failed:number;status:string}> {
  if (!gatewayConfigured()) return {processed:0,ready:0,failed:0,status:"not-configured"};
  const sql=database();
  await sql`update reading_notes set status='failed',lease_until=null,updated_at=now() where status='working' and lease_until<now() and attempts>=3`;
  const token=randomUUID();
  const claimed=await sql<{id:string;source:string;external_id:string;title:string;url:string;summary:string;published_at:Date;importance:number;topics:SignalEvent["topics"]}[]>`
    with served as (select previous.source,count(*) as count from reading_notes completed
      join signal_events previous on previous.id=completed.signal_id
      where completed.status='ready' and completed.version=${ENRICHMENT_VERSION} and completed.updated_at>=date_trunc('hour',now()) group by previous.source),
    eligible as (select note.signal_id,event.source,note.attempts,event.importance,event.first_seen_at,
      row_number() over(partition by event.source,coalesce(event.topics->0->>'topicId','') order by
        case when ${preferRetries} then case when note.status in ('failed','working') then 0 else 1 end
          else case when note.status='pending' then 0 else 1 end end,
        note.attempts,
        case when ${preferOldest} then event.first_seen_at end asc,
        case when exists(select 1 from signal_evidence evidence join source_catalog owner on owner.id=evidence.source and owner.status='active'
          where evidence.signal_id=event.id and length(evidence.body->>'text')>=150) then 0 else 1 end,
        event.importance desc,event.first_seen_at desc) as queue_rank,
      coalesce(served.count,0) as recently_served
      from reading_notes note join signal_events event on event.id=note.signal_id left join served on served.source=event.source
      where ((note.status in ('pending','failed') and note.retry_at<=now() and note.attempts<3) or (note.status='working' and note.lease_until<now() and note.attempts<3))
        and exists(select 1 from signal_observations observation join source_catalog source on source.id=observation.source and source.status='active' where observation.signal_id=event.id)),
    balanced as (select eligible.*,row_number() over(partition by source order by queue_rank,attempts,importance desc,first_seen_at desc) as source_rank from eligible),
    candidates as (select note.signal_id from balanced join reading_notes note on note.signal_id=balanced.signal_id
      order by balanced.source_rank,balanced.recently_served,balanced.queue_rank,balanced.attempts,balanced.importance desc,balanced.first_seen_at desc
      limit ${Math.min(5,Math.max(1,limit))} for update of note skip locked),
    claimed as (update reading_notes note set claim_token=${token},status='working',note=null,failure_code=null,attempts=case when note.version<>${ENRICHMENT_VERSION} then 1 else note.attempts+1 end,version=${ENRICHMENT_VERSION},lease_until=now()+interval '10 minutes' from candidates where note.signal_id=candidates.signal_id returning note.signal_id)
    select event.* from signal_events event join claimed on claimed.signal_id=event.id`;
  let ready=0,failed=0;
  for (const row of claimed) {
    let stage: "evidence" | "hydrate" | "generate" | "context" | "commit" = "evidence";
    try {
      let event=await retrieveStoryEvidence({id:row.id,source:row.source,externalId:row.external_id,title:row.title,url:row.url,summary:row.summary,publishedAt:row.published_at.toISOString(),importance:row.importance,topics:row.topics});
      console.info("SYMTRI reading-note evidence ready",{source:row.source});
      stage = "hydrate";
      // Source hydration may requeue this item. Capture the new revision before generation;
      // a later source change or another worker invalidates the conditional commit.
      const ownership=await sql<{revision:number}[]>`update reading_notes set status='working',attempts=greatest(attempts,1),lease_until=now()+interval '10 minutes' where signal_id=${event.id} and claim_token=${token} returning revision`;
      if (!ownership.length) continue;
      const revision=ownership[0].revision;
      const fresh=await getArchivedSignal(event.id);
      const retained=await getSignalEvidence(event.id);
      if (!fresh || !retained[0]) throw new Error("Source evidence unavailable");
      event={...fresh,evidence:retained[0].body};
      const evidenceSource=retained[0].source;
      const hash=evidenceHash(event);
      const feed={observedAt:new Date().toISOString(),events:[event],sources:unavailableSources(),partial:true,scope:"knowledge" as const};
      const answer=answerKnowledgeQuestion(`Explain this source: ${event.title}`, [{event,similarity:null}]);
      stage = "generate";
      const summary=await synthesize(answer,feed);
      stage = "context";
      const note:ReadingNote={explanation:summary.summary,claims:summary.claims,questions:[`What does this source establish about ${event.title.slice(0,100)}?`,`What limitations does this source report?`],createdAt:new Date().toISOString(),sourceKind:event.evidence!.kind,evidenceSource,evidenceUrl:event.evidence!.url,evidenceAttribution:event.evidence!.attribution,evidenceLicense:event.evidence!.license,context:await loadContext(event)};
      stage = "commit";
      const committed=await sql`update reading_notes set status='ready',note=${sql.json(note)},failure_code=null,input_hash=${hash},version=${ENRICHMENT_VERSION},lease_until=null,updated_at=now() where signal_id=${event.id} and revision=${revision} and claim_token=${token} returning signal_id`;
      ready+=committed.length;
    } catch(error) {
      const reason=readingNoteFailureCode(stage,error);
      // Do not log provider responses, source bodies, request headers, or credentials.
      console.warn("Reading note failed",{source:row.source,stage,reason,errorName:error instanceof Error ? error.name : "unknown"});
      await sql`update reading_notes set status='failed',failure_code=${reason},retry_at=now()+interval '6 hours',lease_until=null,updated_at=now() where signal_id=${row.id} and claim_token=${token} and status='working'`;
      failed++;
    }
  }
  if (claimed.length) console.info("SYMTRI reading-note batch complete",{processed:claimed.length,ready,failed,preferRetries});
  return {processed:claimed.length,ready,failed,status:failed?"partial":"ok"};
}

export async function readingNoteCounts(): Promise<{ready:number;pending:number;failed:number;working:number;completedLastHour:number;activeWorkers:number;lastWorkerAt:Date|null}> {
  const rows=await database()<{ready:number;pending:number;failed:number;working:number;completedLastHour:number;activeWorkers:number;lastWorkerAt:Date|null}[]>`select
    count(*) filter(where status='ready' and version=${ENRICHMENT_VERSION})::int as ready,
    count(*) filter(where status in ('pending','working') or version<>${ENRICHMENT_VERSION})::int as pending,
    count(*) filter(where status='failed' and version=${ENRICHMENT_VERSION})::int as failed,
    count(*) filter(where status='working')::int as working,
    count(*) filter(where status='ready' and updated_at>=now()-interval '1 hour')::int as "completedLastHour",
    (select count(*)::int from reading_note_workers where lease_until>now()) as "activeWorkers",
    (select max(updated_at) from reading_note_workers) as "lastWorkerAt"
    from reading_notes`;
  return rows[0];
}
