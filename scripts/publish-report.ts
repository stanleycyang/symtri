import {readFile} from "node:fs/promises";
import {database} from "../lib/data/storage";
import {getWeeklyReport,reviseLegacyWeeklyReport,saveWeeklyReport} from "../lib/data/reports";
import {REPORT_VERSION} from "../lib/data/report-editorial";
import type {WeeklyDigest} from "../lib/data/digest";
async function main(){
  const path=process.argv[2];
  if(!path)throw new Error("Usage: npm run digest:publish -- artifacts/digests/signal-YYYY-WW.json");
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required");
  const digest=JSON.parse(await readFile(path,"utf8")) as WeeklyDigest;
  if(digest.editorial?.version!==REPORT_VERSION || !digest.editorial.briefs.length || digest.evidenceScope!=="archive")throw new Error("Review an archive-backed draft with checked briefs before publishing");
  try {
    const existing=await getWeeklyReport(digest.week);
    const saved=existing ? await reviseLegacyWeeklyReport(digest) : await saveWeeklyReport(digest);
    console.log(saved ? `Published reviewed briefing ${digest.week}.` : `Edition ${digest.week} already has a briefing; it was preserved.`);
  } finally {await database().end();}
}
main().catch(error=>{console.error(error instanceof Error ? error.message : "Unable to publish briefing");process.exitCode=1;});
