import { enrichBatch, renewReadingNoteWorker } from "./enrichment";

// Renewal must happen inside the processing step: a retried step checks current
// ownership again rather than replaying a previously successful renewal.
export async function enrichOwnedBatch(
  lane: number,
  runId: string,
  preferRetries = false,
  preferOldest = false,
  renew = renewReadingNoteWorker,
  processBatch = enrichBatch,
  now = Date.now,
): Promise<Awaited<ReturnType<typeof enrichBatch>>> {
  const deadline = now() + 120_000;
  const result = { processed: 0, ready: 0, failed: 0, status: "ok" };
  // Claim just one note at a time: notes waiting inside this step cannot lose
  // their own lease while an earlier model call is slow.
  for (let index = 0; index < 5 && now() < deadline; index++) {
    if (!await renew(lane, runId)) return { ...result, status: "lease-lost" };
    const next = await processBatch(1, undefined, undefined, preferRetries, preferOldest);
    result.processed += next.processed;
    result.ready += next.ready;
    result.failed += next.failed;
    if (next.status === "not-configured") return { ...result, status: next.status };
    if (!next.processed) break;
  }
  return { ...result, status: result.failed ? "partial" : "ok" };
}
