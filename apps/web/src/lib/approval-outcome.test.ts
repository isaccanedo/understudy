import assert from "node:assert/strict";
import { test } from "node:test";
import { answeredOutcome } from "./approval-outcome";

test("an answer only shows what really happened to the approval", () => {
  assert.equal(answeredOutcome({ ok: true, status: "approved" }, true), "approved");
  assert.equal(answeredOutcome({ ok: true, status: "denied" }, false), "denied");
  assert.equal(answeredOutcome({ ok: false, status: "cancelled" }, true), "cancelled");
  assert.equal(answeredOutcome({ ok: false, status: "expired" }, true), "expired");
  assert.equal(answeredOutcome({ ok: false, status: "denied" }, true), "denied");
  assert.equal(answeredOutcome({ ok: false, status: null }, true), "unanswered");
  assert.equal(answeredOutcome(undefined, true), "unanswered");
});
