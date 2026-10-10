import assert from "node:assert/strict";
import { test } from "node:test";
import { sameSecret } from "./secret-compare";

test("secrets compare by value, whatever their length", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abd"), false);
  assert.equal(sameSecret("", "abc"), false);
  assert.equal(sameSecret("a".repeat(10), "a".repeat(11)), false);
});
