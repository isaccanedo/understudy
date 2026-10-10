import assert from "node:assert/strict";
import { test } from "node:test";
import { emailDomains } from "./email-domains";

test("lists a single domain as is", () => {
  assert.equal(emailDomains(["example.com"], "en"), "@example.com");
});

test("joins several domains with or in each locale", () => {
  assert.equal(emailDomains(["example.com", "example.org"], "en"), "@example.com or @example.org");
  assert.equal(emailDomains(["example.com", "example.org"], "pt-BR"), "@example.com ou @example.org");
});
