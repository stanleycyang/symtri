import { availableReadingNoteLanes, claimableReadingNoteCount, releaseReadingNoteWorker, reserveReadingNoteWorker } from "./enrichment";

// Reservation precedes start: simultaneous cron and ingest wake-ups cannot
// launch duplicate workers. Failed or lost dispatches recover after lease expiry.
export async function dispatchReadingNotes(slot: string, launch: (slot: string, lane: number) => Promise<unknown>,
  available = availableReadingNoteLanes, count = claimableReadingNoteCount,
  reserve = reserveReadingNoteWorker, release = releaseReadingNoteWorker) {
  const lanes = await available(4);
  const eligible = lanes.length ? await count(lanes.length) : 0;
  let queued = 0;
  let attempted = 0;
  for (const lane of lanes.slice(0, eligible)) {
    const runId = `${slot}:${lane}`;
    if (!await reserve(lane, runId)) continue;
    attempted++;
    try { await launch(slot, lane); queued++; }
    catch { await release(lane, runId); }
  }
  return { slot, queued, expected: attempted, status: queued ? "queued" : attempted ? "unavailable" : "idle" };
}
