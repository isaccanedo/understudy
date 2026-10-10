import assert from "node:assert/strict";
import { test } from "node:test";
import { IDLE_SLEEP_MS, shouldSleep, type IdleSignals } from "./idle";

const resting: IdleSignals = { idleMs: IDLE_SLEEP_MS, viewers: 0, recording: false, runningJobs: 0, state: "calm", runningRuns: 0, pendingApprovals: 0, watches: 0 };

test("a computer with nothing going on sleeps after the idle limit", () => {
  assert.equal(shouldSleep(resting), true);
  assert.equal(shouldSleep({ ...resting, state: "done" }), true);
  assert.equal(shouldSleep({ ...resting, idleMs: IDLE_SLEEP_MS - 1 }), false);
});

test("a computer stays on while anything still needs it", () => {
  assert.equal(shouldSleep({ ...resting, viewers: 1 }), false);
  assert.equal(shouldSleep({ ...resting, recording: true }), false);
  assert.equal(shouldSleep({ ...resting, runningJobs: 1 }), false);
  assert.equal(shouldSleep({ ...resting, state: "working" }), false);
  assert.equal(shouldSleep({ ...resting, state: "waiting_you" }), false);
  assert.equal(shouldSleep({ ...resting, runningRuns: 1 }), false);
  assert.equal(shouldSleep({ ...resting, pendingApprovals: 1 }), false);
  assert.equal(shouldSleep({ ...resting, watches: 1 }), false);
});
