import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { env, isAllowedEmail } from "./env";

const saved = process.env.UNDERSTUDY_ALLOWED_EMAIL_DOMAIN;

afterEach(() => {
  process.env.UNDERSTUDY_ALLOWED_EMAIL_DOMAIN = saved;
});

test("accepts every domain in a comma separated list", () => {
  process.env.UNDERSTUDY_ALLOWED_EMAIL_DOMAIN = "example.com, @Example.org";
  assert.deepEqual(env.allowedEmailDomains, ["example.com", "example.org"]);
  assert.equal(isAllowedEmail("ana@example.com"), true);
  assert.equal(isAllowedEmail("Bia@EXAMPLE.org"), true);
  assert.equal(isAllowedEmail("eve@example.net"), false);
  assert.equal(isAllowedEmail("eve@notexample.com"), false);
});

test("a single domain keeps working as before", () => {
  process.env.UNDERSTUDY_ALLOWED_EMAIL_DOMAIN = "example.com";
  assert.deepEqual(env.allowedEmailDomains, ["example.com"]);
  assert.equal(isAllowedEmail("ana@example.com"), true);
  assert.equal(isAllowedEmail("ana@example.org"), false);
});

test("no domain leaves the list empty", () => {
  process.env.UNDERSTUDY_ALLOWED_EMAIL_DOMAIN = "";
  assert.deepEqual(env.allowedEmailDomains, []);
});
