import assert from "node:assert/strict";
import { test } from "node:test";
import { credentialSite } from "./credential-site";

test("a login is tied to the host of its site", () => {
  assert.equal(credentialSite("https://Bank.example.com/login?x=1"), "bank.example.com");
  assert.equal(credentialSite("bank.example.com"), "bank.example.com");
  assert.equal(credentialSite("bank.example.com:8443/path"), "bank.example.com");
});

test("a login without a usable site is refused", () => {
  for (const value of [undefined, null, "", "   ", "localhost", "*", "not a host", "http://", "bank..com", "-bad.example.com", 42]) {
    assert.equal(credentialSite(value), null, String(value));
  }
});
