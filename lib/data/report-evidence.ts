import {database} from "./storage";
import {ENRICHMENT_VERSION} from "./reading-note-version";
import type {SignalEvent, SourceEvidence} from "./model";
import type {ReadingNote} from "./enrichment";
import type {ReportCandidate} from "./report-editorial";
import {usefulNodeCandidate} from "../email/selection";
import {validatePassages} from "../ai/summarize";

/** Only current published notes with the retained evidence that backs their claims. */
export async function getReportCandidates(events: SignalEvent[], asOf: string): Promise<{candidates:ReportCandidate[];readyCount:number}> {
  if (!events.length) return {candidates:[],readyCount:0};
  const sql=database();
  const count=await sql<{count:number}[]>`select count(*)::int as count from reading_notes note
    join source_catalog source on source.id=note.note->>'evidenceSource' and source.status='active'
    where note.signal_id=any(${events.map(event=>event.id)}) and note.status='ready'
      and note.version=${ENRICHMENT_VERSION} and note.published_revision=note.revision
      and note.published_at<=${asOf}::timestamptz`;
  // Rank metadata first; retain a bounded text payload without limiting archive counts.
  const rows=await sql<{signal_id:string;note:ReadingNote;body:SourceEvidence}[]>`
    with daily as (
      select note.signal_id,note.note,event.published_at,event.importance,
        row_number() over(partition by note.note->>'evidenceSource',(event.published_at at time zone 'UTC')::date
          order by event.importance desc,event.published_at desc,event.id) as day_rank
      from reading_notes note join signal_events event on event.id=note.signal_id
      join source_catalog source on source.id=note.note->>'evidenceSource' and source.status='active'
      where note.signal_id=any(${events.map(event=>event.id)}) and note.status='ready'
        and note.version=${ENRICHMENT_VERSION} and note.published_revision=note.revision
        and note.published_at<=${asOf}::timestamptz and note.note->>'sourceKind'<>'discussion'
    ), ranked as (
      select *,row_number() over(partition by note->>'evidenceSource' order by day_rank,importance desc,published_at desc,signal_id) as source_rank from daily
    ), candidates as (select * from ranked where source_rank<=16 order by source_rank,signal_id limit 160)
    select candidates.signal_id,candidates.note,evidence.body from candidates
    join lateral (select body from signal_evidence where signal_id=candidates.signal_id
      and source=candidates.note->>'evidenceSource' and body->>'url'=candidates.note->>'evidenceUrl'
      order by retrieved_at desc limit 1) evidence on true`;
  const byId=new Map(events.map(event=>[event.id,event]));
  const seen=new Set<string>();
  const candidates=rows.flatMap(row=>{
    const event=byId.get(row.signal_id);
    if(!event || seen.has(event.id) || !row.note.claims?.length || !row.body.text || row.body.kind==="discussion") return [];
    try {
      validatePassages(row.note.claims,[{id:event.id,title:event.title,summary:row.body.text}]);
      seen.add(event.id);
      return [{event,note:row.note,evidence:row.body}];
    } catch {return [];}
  });
  return {candidates,readyCount:count[0]?.count ?? 0};
}

const NODE_CANDIDATE_LIMIT = 6;
const NODE_SCAN_LIMIT = 48;

/** Refill exact-node pools after validation, with bounded, sequential reads. */
export async function getNodeReportCandidates(events:SignalEvent[],asOf:string,window?:{start:string;end:string}):Promise<Map<string,ReportCandidate[]>> {
  if (!events.length) return new Map();
  const sql = database();
  const byId = new Map(events.map(event => [event.id, event]));
  // Archive reads apply the current classifier. Stored topics can still be stale
  // or miss a newly matched node while hourly reclassification is catching up.
  const memberships = [...byId.values()].map(event => ({
    signal_id: event.id,
    node_ids: [...new Set(event.topics.flatMap(match => [match.topicId, ...(match.subtopicId ? [match.subtopicId] : [])]))],
  }));
  const pending = new Set(memberships.flatMap(item => item.node_ids));
  const result = new Map<string,ReportCandidate[]>();
  for (let offset = 0; offset < NODE_SCAN_LIMIT && pending.size; offset += NODE_CANDIDATE_LIMIT) {
    const rows = await sql<{node_id:string;signal_id:string;note:ReadingNote;body:SourceEvidence|null}[]>`
      with matches as (
        select event.id as signal_id,event.importance,event.published_at,note.note,node.node_id
        from jsonb_to_recordset(${sql.json(memberships)}) membership(signal_id text,node_ids jsonb)
        join signal_events event on event.id=membership.signal_id
        join reading_notes note on note.signal_id=event.id
        join source_catalog source on source.id=note.note->>'evidenceSource' and source.status='active'
        cross join lateral jsonb_array_elements_text(membership.node_ids) node(node_id)
        where node.node_id=any(${[...pending]})
          and event.first_seen_at<=${asOf}::timestamptz
          and ${window ? sql`event.published_at>=${window.start}::timestamptz and event.published_at<${window.end}::timestamptz` : sql`true`}
          and note.status='ready' and note.version=${ENRICHMENT_VERSION}
          and note.published_revision=note.revision and note.published_at<=${asOf}::timestamptz
          and note.note->>'sourceKind'<>'discussion'
      ), ranked as (
        select *,row_number() over(partition by node_id order by (note->>'synthesisMethod'='model') desc nulls last,
          jsonb_path_exists(note,'$.claims[*] ? (@.kind == "implication")') desc,
          least(importance,30) desc,published_at desc,signal_id) as node_rank from matches
      ), candidates as (
        select * from ranked where node_rank>${offset} and node_rank<=${offset + NODE_CANDIDATE_LIMIT}
      )
      select candidates.node_id,candidates.signal_id,candidates.note,evidence.body from candidates
      left join lateral (select body from signal_evidence where signal_id=candidates.signal_id
        and source=candidates.note->>'evidenceSource' and body->>'url'=candidates.note->>'evidenceUrl'
        order by retrieved_at desc limit 1) evidence on true
      order by candidates.node_id,candidates.node_rank`;
    const scanned = new Map<string,number>();
    for (const row of rows) {
      scanned.set(row.node_id, (scanned.get(row.node_id) ?? 0) + 1);
      const event = byId.get(row.signal_id);
      const evidence = row.body;
      if (!event || !evidence?.text || evidence.kind === "discussion"
        || !row.note.claims?.some(claim => claim.kind === 'fact' || !claim.kind)) continue;
      const candidate = {event,note:row.note,evidence};
      if (!usefulNodeCandidate(candidate,row.node_id)) continue;
      try {
        validatePassages(row.note.claims,[{id:event.id,title:event.title,summary:evidence.text}]);
        const list = result.get(row.node_id) ?? [];
        if (list.length < NODE_CANDIDATE_LIMIT && !list.some(item => item.event.id === event.id)) list.push(candidate);
        result.set(row.node_id,list);
      } catch { /* Unsupported notes cannot enter personalized emails. */ }
    }
    for (const nodeId of pending) {
      if ((result.get(nodeId)?.length ?? 0) >= NODE_CANDIDATE_LIMIT || (scanned.get(nodeId) ?? 0) < NODE_CANDIDATE_LIMIT) pending.delete(nodeId);
    }
  }
  return result;
}
