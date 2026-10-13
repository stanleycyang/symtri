import {buildNodeEditions,PERSONALIZATION_VERSION} from "../email/personalization";
import {getNodeReportCandidates} from "./report-evidence";
import {createButtondownDraft} from "../email/buttondown";
import {database,getWeeklyArchive} from "./storage";
import {getReportCandidates} from "./report-evidence";
import {REPORT_VERSION,selectReportCandidates,briefFromReadingNote} from "./report-editorial";
import {rankReportCandidates,writeReportBrief} from "../ai/report";
import {gatewayConfigured} from "../ai/gateway";
import {selectDistinctHeadlines} from "./select";
import {buildWeeklyDigest, isoWeek, type WeeklyDigest} from "./digest";
import type {SignalFeed} from "./model";
export function completedWeekEnd(now = new Date()): Date {
  const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
  end.setUTCDate(end.getUTCDate()-((end.getUTCDay()+6)%7));
  return end;
}
export type WeeklyReport = {week:string;publishedAt:string;digest:WeeklyDigest};
export async function getWeeklyReport(week:string): Promise<WeeklyReport|null> {
  if(!/^\d{4}-\d{2}$/.test(week) || !process.env.DATABASE_URL)return null;
  const rows=await database()<{week:string;published_at:Date;digest:WeeklyDigest}[]>`select * from weekly_reports where week=${week}`;
  return rows[0] ? {week:rows[0].week,publishedAt:rows[0].published_at.toISOString(),digest:rows[0].digest} : null;
}
export async function listWeeklyReports(): Promise<(Omit<WeeklyReport,"digest"> & {headline?:string;summary?:string;modifiedAt?:string})[]> {
  if(!process.env.DATABASE_URL)return [];
  const rows=await database()<{week:string;published_at:Date;headline:string|null;summary:string|null;modified_at:string|null}[]>`select week,published_at,
    digest#>>'{editorial,briefs,0,title}' as headline,digest#>>'{editorial,briefs,0,whatChanged,text}' as summary,digest->>'revisedAt' as modified_at from weekly_reports order by week desc limit 104`;
  return rows.map(row=>({week:row.week,publishedAt:row.published_at.toISOString(),...(row.modified_at && Number.isFinite(Date.parse(row.modified_at)) ? {modifiedAt:row.modified_at} : {}),...(row.headline ? {headline:row.headline} : {}),...(row.summary ? {summary:row.summary} : {})}));
}
export async function saveWeeklyReport(digest:WeeklyDigest): Promise<boolean> {
  const sql=database();
  const rows=await sql`insert into weekly_reports(week,digest) values(${digest.week},${sql.json(digest)}) on conflict(week) do nothing returning week`;
  return rows.length>0;
}
export async function buildArchivedWeeklyReport(end:Date, asOf=new Date()) {
  if(!Number.isFinite(end.getTime()) || end.getUTCDay()!==1 || end.getUTCHours() || end.getUTCMinutes() || end.getUTCSeconds() || end.getUTCMilliseconds() || end.getTime()>asOf.getTime()) {
    throw new Error("Use the Monday 00:00 UTC end of a completed week");
  }
  const start=new Date(end.getTime()-14*86400000).toISOString();
  const rows=await database()<{captured_at:Date;feed:SignalFeed}[]>`select captured_at,feed from signal_snapshots where day>=${start.slice(0,10)}::date and day<${end.toISOString().slice(0,10)}::date order by day asc limit 14`;
  const snapshots=rows.map(row=>({...row.feed,observedAt:row.captured_at.toISOString()}));
  const archive=await getWeeklyArchive(start,end.toISOString(),asOf.toISOString());
  const boundary=end.getTime()-7*86400000;
  const current=archive.filter(event=>Date.parse(event.publishedAt)>=boundary);
  const previous=archive.filter(event=>Date.parse(event.publishedAt)<boundary);
  const digest=buildWeeklyDigest(end,snapshots,{current,previous});
  const {candidates,readyCount}=await getReportCandidates(current,asOf.toISOString());
  let order:string[]=[];
  if(gatewayConfigured()) {
    try {order=await rankReportCandidates(candidates);} catch { /* Fall back to checked evidence and breadth. */ }
  }
  const selected=selectReportCandidates(candidates,4,order);
  const briefs=[];
  for(const candidate of selected) {
    let brief=briefFromReadingNote(candidate);
    if(gatewayConfigured()) {
      try {brief=await writeReportBrief(candidate);} catch { /* Checked notes remain useful when synthesis is unavailable. */ }
    }
    const related=candidates.filter(item=>item!==candidate
      && !selectDistinctHeadlines([item.event],1,[candidate.event.title]).length).slice(0,2);
    brief.sources.push(...related.map(item=>briefFromReadingNote(item).sources[0]));
    briefs.push(brief);
  }
  // A thread is an exploration route, not a claim that co-classification proves a trend.
  // Require readable evidence from multiple publishers before including it.
  if(digest.emerging) {
    const matching=candidates.filter(candidate=>candidate.event.topics.some(match=>match.subtopicId===digest.emerging!.id));
    const publishers=new Set(matching.map(candidate=>new URL(candidate.evidence.url).hostname));
    digest.emerging=matching.length>=3 && publishers.size>=2
      ? {...digest.emerging,evidence:selectReportCandidates(matching,3).map(candidate=>candidate.event)} : null;
  }
  digest.editorial={version:REPORT_VERSION,briefs:briefs.slice(0,3),watch:briefs[3] ?? null,
    archiveCount:current.length,readyCount,sourceCount:new Set(current.map(event=>event.source)).size};
  return digest;
}

export async function withPersonalizedEditions(digest:WeeklyDigest,asOf=new Date()):Promise<WeeklyDigest> {
 if((digest.personalization?.version ?? 0)>=PERSONALIZATION_VERSION || !digest.editorial?.briefs.length)return digest;
 console.info("Weekly personalization: archive start");
 const events=await getWeeklyArchive(digest.start,digest.end,asOf.toISOString());
 console.info("Weekly personalization: archive ready",events.length);
 const candidates=await getNodeReportCandidates(events,asOf.toISOString(),{start:digest.start,end:digest.end});
 console.info("Weekly personalization: candidates ready",candidates.size);
 const personalization=buildNodeEditions(digest,candidates,asOf.toISOString(),events.length,new Set(events.map(event=>event.source)).size);
 console.info("Weekly personalization: editions ready",personalization.editions.length);
 const sql=database();
 const saved=await sql<{digest:WeeklyDigest}[]>`update weekly_reports set digest=jsonb_set(digest,'{personalization}',${sql.json(personalization)})
  where week=${digest.week} and coalesce((digest#>>'{personalization,version}')::int,0)<${PERSONALIZATION_VERSION} returning digest`;
 return saved[0]?.digest ?? (await getWeeklyReport(digest.week))?.digest ?? {...digest,personalization};
}

export async function publishWeeklyReport(now = new Date()) {
  const end=completedWeekEnd(now);
  const week=isoWeek(new Date(end.getTime()-1));
  const existing=await getWeeklyReport(week);
  if(existing)return {status:"already-published",week,email:await createButtondownDraft(await withPersonalizedEditions(existing.digest,now))};
  const digest=await buildArchivedWeeklyReport(end,now);
  if(!digest.editorial?.briefs.length)return {status:"insufficient-evidence",week};
  const saved=await saveWeeklyReport(digest);
  const published=saved ? digest : (await getWeeklyReport(week))!.digest;
  return {status:saved ? "published" : "already-published",week,email:await createButtondownDraft(await withPersonalizedEditions(published,now))};
}

/** Explicitly upgrade a reviewed legacy edition; routine cron retries stay immutable. */
export async function reviseLegacyWeeklyReport(digest:WeeklyDigest):Promise<boolean> {
  const end=new Date(digest.end);
  if(!/^\d{4}-\d{2}$/.test(digest.week) || !Number.isFinite(end.getTime())
    || end.getUTCDay()!==1 || end.getUTCHours() || end.getUTCMinutes() || end.getUTCSeconds() || end.getUTCMilliseconds()
    || Date.parse(digest.start)!==end.getTime()-7*86400000 || isoWeek(new Date(end.getTime()-1))!==digest.week
    || digest.evidenceScope!=="archive" || digest.editorial?.version!==REPORT_VERSION || !digest.editorial.briefs.length) {
    throw new Error("Use a reviewed archive-backed report draft with checked briefs");
  }
  const sql=database();
  const rows=await sql`update weekly_reports set digest=
    jsonb_set(${sql.json(digest)},'{previousDigest}',digest)
      || jsonb_build_object('revisedAt',${new Date().toISOString()}::text)
    where week=${digest.week} and digest#>>'{editorial,version}' is null returning week`;
  return rows.length===1;
}
