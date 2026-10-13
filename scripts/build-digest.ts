import {mkdir, writeFile} from "node:fs/promises";
import {database} from "../lib/data/storage";
import {renderWeeklyDigest} from "../lib/data/digest";
import {buildArchivedWeeklyReport,completedWeekEnd} from "../lib/data/reports";
async function main() {
const end = process.argv[2] ? new Date(process.argv[2]) : completedWeekEnd();
if (!Number.isFinite(end.getTime())) throw new Error("Use an ISO date for week end");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to build a digest from the archive");
try {
 const digest=await buildArchivedWeeklyReport(end); const rendered=renderWeeklyDigest(digest);
 await mkdir("artifacts/digests",{recursive:true});
 for (const [extension,content] of [["html",rendered.html],["txt",rendered.text],["json",JSON.stringify(digest,null,2)]]) await writeFile(`artifacts/digests/signal-${digest.week}.${extension}`,content);
 console.log(`Digest saved to artifacts/digests/signal-${digest.week}.{html,txt,json}; review before creating a provider draft.`);
} finally {await database().end();}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
