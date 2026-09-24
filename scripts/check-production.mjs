const base = new URL(process.env.SYMTRI_SITE_URL ?? "https://symtri.com");

async function read(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

try {
  const [status, history] = await Promise.all([read("/api/status"), read("/api/history")]);
  const run = status.lastRun;
  if (!run?.completedAt || !["complete", "partial"].includes(run.status)) {
    throw new Error(`Latest ingestion run is ${run?.status ?? "missing"}`);
  }
  const ageMinutes = (Date.now() - Date.parse(run.completedAt)) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > 120) {
    throw new Error(`Latest ingestion run is ${Math.round(ageMinutes)} minutes old`);
  }
  if (status.signals < 1 || status.vectors < 1 || status.embeddingBacklog !== 0 || status.classificationBacklog !== 0) {
    throw new Error("Signal, vector, or classification coverage is incomplete");
  }
  if (!Array.isArray(history.days) || history.days.length < 1) throw new Error("No daily snapshot is available");
  console.log(JSON.stringify({
    completedAt: run.completedAt, status: run.status, sources: run.sources,
    fetched: run.fetched, added: run.added, signals: status.signals, vectors: status.vectors,
    snapshotDays: history.days.map((day) => day.day),
  }));
} catch (error) {
  console.error(`SYMTRI production check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
