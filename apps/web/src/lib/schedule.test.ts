import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCron, toCron } from "./schedule";

test("common schedules round trip", () => {
  for (const cron of ["0 8 * * *", "30 9 * * 1-5", "0 8 * * 1", "15 7 1 * *", ""]) {
    assert.equal(toCron(parseCron(cron)), cron);
  }
});

test("anything else is kept as a custom schedule", () => {
  const schedule = parseCron("*/15 * * * *");
  assert.equal(schedule.mode, "custom");
  assert.equal(toCron(schedule), "*/15 * * * *");
});
