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
  const minimumSignals = Number(process.env.SYMTRI_MIN_SIGNALS ?? 1);
  if (!Number.isInteger(minimumSignals) || minimumSignals < 1) {
    throw new Error("SYMTRI_MIN_SIGNALS must be a positive integer");
  }
  if (status.signals < minimumSignals) {
    throw new Error(`Only ${status.signals} unique signals are available; expected ${minimumSignals}`);
  }
  const requiredSource = process.env.SYMTRI_REQUIRED_SOURCE;
  if (requiredSource) {
    if (!Object.hasOwn(run.sources ?? {}, requiredSource)) {
      throw new Error(`Latest ingestion run has no ${requiredSource} source status`);
    }
    if (run.sources[requiredSource] !== "ok") {
      throw new Error(`${requiredSource} source is ${run.sources[requiredSource]}`);
    }
    if (!signals.events?.some((event) => event.source === requiredSource)) {
      throw new Error(`${requiredSource} has no visible overview signal`);
    }
  }
  if (run.embeddingStatus !== "ok") throw new Error(`Latest embedding step is ${run.embeddingStatus ?? "missing"}`);
  if (signals.lastIngestedAt !== run.completedAt) {
    throw new Error("Public feed does not expose the latest completed ingest time");
  }
  if (!Array.isArray(history.days) || history.days.length < 1) throw new Error("No daily snapshot is available");
  const minimumSnapshotDays = Number(process.env.SYMTRI_MIN_SNAPSHOT_DAYS ?? 1);
  if (!Number.isInteger(minimumSnapshotDays) || minimumSnapshotDays < 1) {
    throw new Error("SYMTRI_MIN_SNAPSHOT_DAYS must be a positive integer");
  }
  if (history.days.length < minimumSnapshotDays) {
    throw new Error(`Only ${history.days.length} snapshot day(s) are available; expected ${minimumSnapshotDays}`);
  }
  if (status.growth?.graphDirtyDays > 0) {
    throw new Error(`Knowledge graph is refreshing ${status.growth.graphDirtyDays} dirty UTC day(s)`);
  }
  if (!signals.relationships || typeof signals.relationships !== "object") {
    throw new Error("Full-window live relationships are unavailable");
  }
  if (!signals.childCounts || typeof signals.childCounts !== "object" || !Number.isInteger(signals.classifierVersion)) {
    throw new Error("Prepared feed or full-window child counts are unavailable; wait for a completed new-code ingest");
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
  const leading = signals.catalog?.topics?.reduce((best, topic) =>
    !best || (signals.activity?.[topic.id]?.count ?? 0) > (signals.activity?.[best.id]?.count ?? 0) ? topic : best, null);
  if (!leading) throw new Error("Public catalog is unavailable");
  const firstPage = await read(`/api/topic?regionId=${encodeURIComponent(leading.id)}&browse=1`);
  if (!Array.isArray(firstPage.events) || !firstPage.events.length || firstPage.events.length > 20) {
    throw new Error(`Archive browser returned an invalid first page for ${leading.id}`);
  }
  let topicPagesVerified = 1;
  if (firstPage.nextCursor) {
    const secondPage = await read(`/api/topic?regionId=${encodeURIComponent(leading.id)}&browse=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`);
    const firstIds = new Set(firstPage.events.map((event) => event.id));
    if (!Array.isArray(secondPage.events) || !secondPage.events.length || secondPage.events.some((event) => firstIds.has(event.id)) ||
      secondPage.events[0].publishedAt > firstPage.events.at(-1).publishedAt) {
      throw new Error(`Archive browser cursor repeated or reordered signals for ${leading.id}`);
    }
    topicPagesVerified = 2;
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
    catalogBacklog: status.growth?.catalogBacklog,
    graphDirtyDays: status.growth?.graphDirtyDays,
    childCounts: Object.keys(signals.childCounts).length,
    topicPagesVerified,
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
