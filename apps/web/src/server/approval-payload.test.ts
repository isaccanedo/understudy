import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalFields, MAX_APPROVAL_FIELDS, MAX_APPROVAL_VALUE, payloadHash, serverAllowedFor } from "./approval-payload";

test("payload hash ignores key order but not values or target", () => {
  const a = payloadHash("srv:send", { to: "a@example.com", body: { x: 1, y: [1, 2] } });
  const b = payloadHash("srv:send", { body: { y: [1, 2], x: 1 }, to: "a@example.com" });
  assert.equal(a, b);
  assert.notEqual(a, payloadHash("srv:send", { to: "a@example.com", body: { x: 1, y: [1, 2] }, bcc: "evil@example.com" }));
  assert.notEqual(a, payloadHash("srv:other", { to: "a@example.com", body: { x: 1, y: [1, 2] } }));
});

test("approval fields show every argument in full", () => {
  const long = "x".repeat(5000);
  const result = approvalFields({ to: "a@example.com", body: long, meta: { a: 1 } });
  const fields = "fields" in result && result.fields ? result.fields : [];
  assert.equal(fields.length, 3);
  assert.equal(fields[1].value, long);
  assert.match(fields[2].value, /"a": 1/);
});

test("approval fields refuse what cannot be shown instead of truncating", () => {
  const many = Object.fromEntries(Array.from({ length: MAX_APPROVAL_FIELDS + 1 }, (_, i) => [`k${i}`, "v"]));
  assert.ok("error" in approvalFields(many));
  assert.ok("error" in approvalFields({ body: "x".repeat(MAX_APPROVAL_VALUE + 1) }));
});

test("server access list", () => {
  assert.equal(serverAllowedFor(null, "a@example.com"), true);
  assert.equal(serverAllowedFor(["A@example.com"], "a@example.com"), true);
  assert.equal(serverAllowedFor(["b@example.com"], "a@example.com"), false);
  assert.equal(serverAllowedFor([], "a@example.com"), false);
});
