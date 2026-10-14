import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { startFeedRefresh } from "./feed-refresh";

test("feed retry bursts are bounded, and recovery resets the next burst", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  let calls = 0;
  let fail = true;
  const states: boolean[] = [];
  const refresh = startFeedRefresh({
    signal: controller.signal, isVisible: () => true,
    load: async () => { calls++; if (fail) throw new Error("Unavailable"); },
    onFailure: (retrying) => states.push(retrying),
    retryDelaysMs: [10, 20], intervalMs: 100, jitterMs: () => 0,
  });
  try {
    await setImmediate();
    t.mock.timers.tick(10); await setImmediate();
    t.mock.timers.tick(20); await setImmediate();
    assert.equal(calls, 3);
    assert.deepEqual(states, [true, true, false]);
    t.mock.timers.tick(99); await setImmediate(); assert.equal(calls, 3);
    fail = false;
    refresh(); await setImmediate(); assert.equal(calls, 4);
    fail = true;
    refresh(); await setImmediate();
    t.mock.timers.tick(10); await setImmediate();
    assert.equal(calls, 6);
    assert.equal(states.at(-1), true);
  } finally { controller.abort(); }
});

test("visibility and refresh events never overlap an active feed request", async () => {
  const controller = new AbortController();
  let calls = 0;
  let complete: () => void = () => {};
  const refresh = startFeedRefresh({
    signal: controller.signal, isVisible: () => true,
    load: () => { calls++; return new Promise<void>((resolve) => { complete = resolve; }); },
    onFailure: () => assert.fail("Unexpected failure"),
  });
  try {
    refresh(); refresh();
    assert.equal(calls, 1);
    complete(); await setImmediate();
    refresh(); assert.equal(calls, 2);
    controller.abort(); complete(); await setImmediate();
    refresh(); assert.equal(calls, 2);
  } finally { controller.abort(); }
});

test("hidden tabs pause retry work and cleanup cancels scheduled requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  let visible = false;
  let calls = 0;
  const refresh = startFeedRefresh({
    signal: controller.signal, isVisible: () => visible,
    load: async () => { calls++; throw new Error("Unavailable"); },
    onFailure: () => {}, retryDelaysMs: [10], intervalMs: 100, jitterMs: () => 0,
  });
  assert.equal(calls, 0);
  visible = true;
  refresh(); await setImmediate(); assert.equal(calls, 1);
  visible = false;
  t.mock.timers.tick(10); await setImmediate(); assert.equal(calls, 1);
  visible = true;
  refresh(); await setImmediate(); assert.equal(calls, 2);
  controller.abort();
  t.mock.timers.tick(10_000); await setImmediate(); assert.equal(calls, 2);
});
