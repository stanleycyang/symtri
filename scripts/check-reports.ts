import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {database} from "../lib/data/storage";
import {buildWeeklyDigest} from "../lib/data/digest";
import {saveWeeklyReport,getWeeklyReport,listWeeklyReports,publishWeeklyReport} from "../lib/data/reports";
import {GET} from "../app/api/digest/route";
async function main() {
const url=process.env.SYMTRI_TEST_DATABASE_URL;
if(!url || !["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname))throw new Error("Use an isolated loopback database");
process.env.DATABASE_URL=url;
const sql=database();
let migrated=false;
try {
  await sql.unsafe("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;");
  await sql.unsafe(await readFile(new URL("../supabase/migrations/20261012000000_weekly_reports.sql",import.meta.url),"utf8"));
  migrated=true;
  const digest=buildWeeklyDigest(new Date("2026-10-12"),[]);
  assert.equal(await saveWeeklyReport(digest),true);
  assert.equal(await saveWeeklyReport({...digest,signals:[],coverage:{currentDays:7,previousDays:7}}),false);
  assert.deepEqual((await getWeeklyReport(digest.week))?.digest.coverage,digest.coverage,"Retries preserve the original edition");
  assert.equal((await listWeeklyReports())[0].week,digest.week);
  const table=await sql`select relrowsecurity from pg_class where oid='weekly_reports'::regclass`;
  assert.equal(table[0].relrowsecurity,true);
  const access=await sql`select has_table_privilege('anon','weekly_reports','SELECT') as readable`;
  assert.equal(access[0].readable,false,"Public clients cannot bypass the server reader");
  process.env.CRON_SECRET="isolated-report-test";
  assert.equal((await GET(new Request("https://symtri.com/api/digest"))).status,401);
  const authorized=await GET(new Request("https://symtri.com/api/digest",{headers:{authorization:"Bearer isolated-report-test"}}));
  assert.equal(authorized.status,200);
  assert.equal((await authorized.json()).status,"insufficient-evidence");
  const none=await publishWeeklyReport(new Date("2040-01-02"));assert.equal(none.status,"insufficient-evidence");
  const snapshot={observedAt:"2039-12-31T12:00:00Z",events:[{id:"report-test",source:"arxiv",externalId:"report-test",title:"A grounded weekly source",url:"https://arxiv.org/abs/report-test",summary:"Test",publishedAt:"2039-12-31T12:00:00Z",importance:1,topics:[{topicId:"ai",subtopicId:"ai-agents",relevance:1}]}],sources:{arxiv:"ok"},partial:false,scope:"history"};
  await sql`insert into signal_snapshots(day,captured_at,feed) values('2039-12-31','2039-12-31T12:00:00Z',${sql.json(snapshot)})`;
  const published=await publishWeeklyReport(new Date("2040-01-02"));assert.equal(published.status,"published");
  assert.equal((await publishWeeklyReport(new Date("2040-01-02"))).status,"already-published");
  assert.equal((await getWeeklyReport(published.week))?.digest.signals.length,1);
  console.log("Weekly reports: JSONB payload, immutable retries, completed-week publication, empty evidence, private table, and unauthorized cron passed.");
} finally {if(migrated){await sql`delete from weekly_reports`;await sql`delete from signal_snapshots where day='2039-12-31'`;}await sql.end();}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
