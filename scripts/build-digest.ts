import {mkdir, writeFile} from "node:fs/promises";
import {getSnapshotDays, getSnapshotFeed, database} from "../lib/data/storage";
import {buildWeeklyDigest, renderWeeklyDigest} from "../lib/data/digest";
import type {SignalFeed} from "../lib/data/model";
const end = new Date(process.argv[2] ?? new Date().toISOString());
if (!Number.isFinite(end.getTime())) throw new Error("Use an ISO date for week end");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to build a digest from snapshots");
try {
 const snapshots: SignalFeed[]=[];
 for (const day of await getSnapshotDays()) {const feed=await getSnapshotFeed(day.day);if(feed)snapshots.push(feed);}
 const digest=buildWeeklyDigest(end,snapshots); const rendered=renderWeeklyDigest(digest);
 await mkdir("artifacts/digests",{recursive:true});
 for (const [extension,content] of [["html",rendered.html],["txt",rendered.text],["json",JSON.stringify(digest,null,2)]]) await writeFile(`artifacts/digests/signal-${digest.week}.${extension}`,content);
 console.log(`Digest saved to artifacts/digests/signal-${digest.week}.{html,txt,json}; review before creating a provider draft.`);
} finally {await database().end();}
