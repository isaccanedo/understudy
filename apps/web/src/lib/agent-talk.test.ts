import assert from "node:assert/strict";
import { test } from "node:test";
import { pairKey, parseTalkCeiling, pastCeiling } from "./agent-talk";

test("the talk ceiling is off unless set to a positive whole number", () => {
  for (const raw of [undefined, "", "  ", "abc", "0", "-3", "2.5"]) assert.equal(parseTalkCeiling(raw), null);
  assert.equal(parseTalkCeiling(" 6 "), 6);
});

test("without a ceiling no depth is too deep, and with one only what goes past it is", () => {
  assert.equal(pastCeiling(1_000_000, null), false);
  assert.equal(pastCeiling(6, 6), false);
  assert.equal(pastCeiling(7, 6), true);
});

test("a pair is the same pair in either direction", () => {
  assert.deepEqual(pairKey("agt_b", "agt_a"), ["agt_a", "agt_b"]);
  assert.deepEqual(pairKey("agt_a", "agt_b"), ["agt_a", "agt_b"]);
});
