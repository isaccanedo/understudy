import assert from "node:assert/strict";
import { test } from "node:test";
import { open, seal } from "./secret-box";

test("seal and open round trip without exposing the value", () => {
  process.env.BETTER_AUTH_SECRET = "test-secret";
  const sealed = seal("Bearer abc123");
  assert.ok(!sealed.includes("abc123"));
  assert.equal(open(sealed), "Bearer abc123");
});

test("a different secret cannot open the value", () => {
  process.env.BETTER_AUTH_SECRET = "test-secret";
  const sealed = seal("value");
  process.env.BETTER_AUTH_SECRET = "other-secret";
  assert.throws(() => open(sealed));
});

test("empty stays empty", () => {
  assert.equal(seal(""), "");
  assert.equal(open(""), "");
});
