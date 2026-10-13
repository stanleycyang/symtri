import {readFile} from "node:fs/promises";
import {createButtondownDraft} from "../lib/email/buttondown";
import type {WeeklyDigest} from "../lib/data/digest";
async function main(){
  const path=process.argv[2];
  if(!path || !process.env.BUTTONDOWN_API_KEY)throw new Error("Use digest:buttondown -- reviewed-report.json with BUTTONDOWN_API_KEY configured");
  const digest=JSON.parse(await readFile(path,"utf8")) as WeeklyDigest;
  console.log(await createButtondownDraft(digest));
}
main().catch(error=>{console.error(error instanceof Error ? error.message : "Draft failed");process.exitCode=1;});
