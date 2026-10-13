import {database} from "./storage";
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
export async function listWeeklyReports(): Promise<Omit<WeeklyReport,"digest">[]> {
  if(!process.env.DATABASE_URL)return [];
  const rows=await database()<{week:string;published_at:Date}[]>`select week,published_at from weekly_reports order by week desc limit 104`;
  return rows.map(row=>({week:row.week,publishedAt:row.published_at.toISOString()}));
}
export async function saveWeeklyReport(digest:WeeklyDigest): Promise<boolean> {
  const sql=database();
  const rows=await sql`insert into weekly_reports(week,digest) values(${digest.week},${sql.json(digest)}) on conflict(week) do nothing returning week`;
  return rows.length>0;
}
export async function publishWeeklyReport(now = new Date()) {
  const end=completedWeekEnd(now);
  const week=isoWeek(new Date(end.getTime()-1));
  if(await getWeeklyReport(week))return {status:"already-published",week};
  const start=new Date(end.getTime()-14*86400000).toISOString().slice(0,10);
  const rows=await database()<{captured_at:Date;feed:SignalFeed}[]>`select captured_at,feed from signal_snapshots where day>=${start}::date and day<${end.toISOString().slice(0,10)}::date order by day asc limit 14`;
  const snapshots=rows.map(row=>({...row.feed,observedAt:row.captured_at.toISOString()}));
  const digest={...buildWeeklyDigest(end,snapshots),week};
  if(!digest.coverage.currentDays || !digest.signals.length)return {status:"insufficient-evidence",week};
  return {status:await saveWeeklyReport(digest) ? "published" : "already-published",week};
}
