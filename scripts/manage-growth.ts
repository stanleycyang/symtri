import { database } from "../lib/data/storage";
import { recordCatalogRevision } from "../lib/data/catalog";
import { deactivateConcept, mergeConcepts, reactivateConcept } from "../lib/data/discovery";

const [action, id, target] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !id || !["point-inactive", "point-public", "point-merge", "feed-pause", "feed-trial", "feed-active"].includes(action ?? "")) {
  throw new Error("Usage: npm run growth:manage -- <point-inactive|point-public|point-merge|feed-pause|feed-trial|feed-active> <id> [merge-target]");
}
if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) throw new Error("Invalid ID");
if (action === "point-inactive") await deactivateConcept(id);
else if (action === "point-public") await reactivateConcept(id);
else if (action === "point-merge") {
  if (!target || !/^[a-z0-9][a-z0-9-]{1,80}$/.test(target)) throw new Error("A valid merge target is required");
  await mergeConcepts(id, target);
} else {
  const status = action === "feed-pause" ? "paused" : action === "feed-trial" ? "trial" : "active";
  const changed = await database()`update source_catalog set status = ${status},
    pause_reason = ${status === "paused" ? "manual" : null}, consecutive_failures = 0,
    last_checked_at = null where id = ${id} and kind = 'rss' returning id`;
  if (!changed.length) throw new Error("Unknown feed");
  await recordCatalogRevision();
}
console.log(`${action} completed for ${id}`);
process.exit(0);
