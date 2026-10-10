import assert from "node:assert/strict";
import { test } from "node:test";

process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";

const { contentToken, readContentToken, newShareToken, shareTokenHash, validShareToken } = await import("./tokens");

test("a content token opens exactly one version until it expires", () => {
  const now = Date.UTC(2026, 9, 9, 12);
  const token = contentToken("arv_abcdefgh1234", now);
  assert.equal(readContentToken(token, now), "arv_abcdefgh1234");
  assert.equal(readContentToken(token, now + 59 * 60 * 1000), "arv_abcdefgh1234");
  assert.equal(readContentToken(token, now + 61 * 60 * 1000), null);
});

test("a tampered content token is refused", () => {
  const now = Date.now();
  const token = contentToken("arv_abcdefgh1234", now);
  const [, expires, signature] = token.split(".");
  assert.equal(readContentToken(`arv_otherversion1.${expires}.${signature}`, now), null);
  assert.equal(readContentToken(`arv_abcdefgh1234.${Number(expires) + 9999}.${signature}`, now), null);
  assert.equal(readContentToken(`${token}x`, now), null);
  assert.equal(readContentToken("arv_abcdefgh1234", now), null);
  assert.equal(readContentToken("../../etc/passwd", now), null);
  assert.throws(() => contentToken("../x"));
});

test("share tokens are random, have a fixed shape and are stored only as a hash", () => {
  const a = newShareToken();
  const b = newShareToken();
  assert.notEqual(a, b);
  assert.equal(validShareToken(a), true);
  assert.equal(validShareToken("short"), false);
  assert.equal(validShareToken(`${a.slice(0, 31)}/`), false);
  assert.match(shareTokenHash(a), /^[a-f0-9]{64}$/);
  assert.notEqual(shareTokenHash(a), a);
});
