import { database } from "../lib/data/storage";
import { ENRICHMENT_VERSION } from "../lib/data/reading-note-version";

const [action,id]=process.argv.slice(2);
if(action!=="retry" || !id || id.length>200 || !/^[\w:.-]+$/.test(id) || !process.env.DATABASE_URL) {
  throw new Error("Usage with DATABASE_URL configured: npm run enrichment:manage -- retry <signal-id>");
}
// An operator can retry a single blocked input after fixing its provider or
// source. Live ownership is preserved; no working or ready note is reset.
const rows=await database()`update reading_notes set status='pending',blocked=false,
  attempts=0,retry_at=now(),queued_at=now(),lease_until=null,claim_token=null,
  failure_code=null,version=${ENRICHMENT_VERSION},revision=revision+1,updated_at=now()
  where signal_id=${id} and status='failed' returning signal_id`;
if(!rows.length) throw new Error("No failed note found for this signal");
console.log(`Queued one reading note: ${id}`);
process.exit(0);
