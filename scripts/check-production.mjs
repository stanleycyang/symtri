const base = new URL(process.env.SYMTRI_SITE_URL ?? "https://symtri.com");

async function read(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (!response.ok) throw Object.assign(new Error(`${path} returned HTTP ${response.status}`), { status: response.status });
      return await response.json();
    } catch (error) {
      if ((error.status && error.status < 500) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
}

try {
  const [status, history, signals] = await Promise.all([read("/api/status"), read("/api/history"), read("/api/signals")]);
  const run = status.lastRun;
  if (!run?.completedAt || !["complete", "partial"].includes(run.status)) {
    throw new Error(`Latest ingestion run is ${run?.status ?? "missing"}`);
  }
  if (process.env.SYMTRI_REQUIRE_SOURCES_AVAILABLE === "1") {
    for (const source of ["hacker-news", "github", "arxiv"]) {
      if (!["ok", "partial"].includes(run.sources?.[source])) {
        throw new Error(`Latest ingestion run has no usable ${source} coverage`);
      }
    }
  }
  const ageMinutes = (Date.now() - Date.parse(run.completedAt)) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > 120) {
    throw new Error(`Latest ingestion run is ${Math.round(ageMinutes)} minutes old`);
  }
  const minimumCompletedAt = process.env.SYMTRI_MIN_COMPLETED_AT;
  if (minimumCompletedAt) {
    const minimum = Date.parse(minimumCompletedAt);
    if (!Number.isFinite(minimum)) throw new Error("SYMTRI_MIN_COMPLETED_AT must be a valid timestamp");
    if (Date.parse(run.completedAt) < minimum) {
      throw new Error(`Latest ingestion run completed before ${minimumCompletedAt}`);
    }
  }
  if (status.signals < 1 || status.vectors < 1 || status.embeddingBacklog !== 0) {
    throw new Error("Signal or vector coverage is incomplete");
  }
  if (run.embeddingStatus !== "ok") throw new Error(`Latest embedding step is ${run.embeddingStatus ?? "missing"}`);
  if (signals.lastIngestedAt !== run.completedAt) {
    throw new Error("Public feed does not expose the latest completed ingest time");
  }
  if (!Array.isArray(history.days) || history.days.length < 1) throw new Error("No daily snapshot is available");
  if (!signals.relationships || typeof signals.relationships !== "object") {
    throw new Error("Full-window live relationships are unavailable");
  }
  const known = new Set(Object.keys(signals.activity ?? {}));
  const sampledRelationships = {};
  for (const event of signals.events ?? []) {
    const ids = [...new Set(event.topics.map((match) => match.topicId).filter((id) => known.has(id)))].sort();
    for (let first = 0; first < ids.length; first++) for (let second = first + 1; second < ids.length; second++) {
      const key = `${ids[first]}:${ids[second]}`;
      sampledRelationships[key] = (sampledRelationships[key] ?? 0) + 1;
    }
  }
  for (const [key, count] of Object.entries(sampledRelationships)) {
    if ((signals.relationships[key] ?? 0) < count) throw new Error(`Live relationship ${key} is below its map sample`);
  }
  const verifiedDays = history.days.slice(0, 2).map((item) => item.day);
  const snapshots = await Promise.all(verifiedDays.map((day) => read(`/api/history?day=${encodeURIComponent(day)}`)));
  for (const [index, snapshot] of snapshots.entries()) {
    const day = verifiedDays[index];
    if (!Array.isArray(snapshot.events) || !snapshot.events.length || snapshot.observedAt?.slice(0, 10) !== day) {
      throw new Error(`Snapshot ${day} has no valid historical sample`);
    }
    if (!snapshot.activity || typeof snapshot.activity !== "object") {
      throw new Error(`Snapshot ${day} has no full-window activity`);
    }
    if (!snapshot.relationships || typeof snapshot.relationships !== "object") {
      throw new Error(`Snapshot ${day} has no full-window relationships`);
    }
    if (!Number.isInteger(snapshot.archiveCount) || snapshot.archiveCount < snapshot.events.length || snapshot.archiveCount > status.signals) {
      throw new Error(`Snapshot ${day} has no valid point-in-time archive count`);
    }
  }
  console.log(JSON.stringify({
    completedAt: run.completedAt, status: run.status, sources: run.sources,
    fetched: run.fetched, added: run.added, signals: status.signals, vectors: status.vectors,
    embeddingBacklog: status.embeddingBacklog, embeddingStatus: run.embeddingStatus,
    classificationBacklog: status.classificationBacklog,
    snapshotDays: history.days.map((day) => day.day),
    liveRelationships: Object.keys(signals.relationships).length,
    snapshotRelationships: Object.keys(snapshots[0].relationships).length,
    verifiedSnapshotCounts: snapshots.map((snapshot) => snapshot.archiveCount),
    verifiedSnapshotDays: verifiedDays,
  }));
} catch (error) {
  console.error(`SYMTRI production check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
