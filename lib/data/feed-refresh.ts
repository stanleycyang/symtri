type FeedRefreshOptions = {
  signal: AbortSignal;
  load: (signal: AbortSignal) => Promise<void>;
  onFailure: (retrying: boolean) => void;
  isVisible: () => boolean;
  intervalMs?: number;
  retryDelaysMs?: readonly number[];
  jitterMs?: () => number;
};

/** One request at a time, with a bounded retry burst and normal refresh after it. */
export function startFeedRefresh({
  signal, load, onFailure, isVisible,
  intervalMs = 15 * 60 * 1000,
  retryDelaysMs = [1_000, 2_000, 4_000, 8_000],
  jitterMs = () => Math.floor(Math.random() * 400),
}: FeedRefreshOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let failures = 0;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = (delay: number) => {
    clearTimer();
    if (!signal.aborted) timer = setTimeout(refresh, delay);
  };
  const refresh = () => {
    if (signal.aborted || inFlight) return;
    clearTimer();
    if (!isVisible()) { schedule(intervalMs); return; }
    inFlight = true;
    void (async () => {
      try {
        await load(signal);
        if (signal.aborted) return;
        failures = 0;
        schedule(intervalMs);
      } catch {
        if (signal.aborted) return;
        const delay = retryDelaysMs[failures++];
        onFailure(delay !== undefined);
        if (delay === undefined) {
          failures = 0;
          schedule(intervalMs);
        } else schedule(delay + jitterMs());
      } finally { inFlight = false; }
    })();
  };
  signal.addEventListener("abort", clearTimer, { once: true });
  refresh();
  return refresh;
}
