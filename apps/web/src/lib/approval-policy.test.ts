import assert from "node:assert/strict";
import { test } from "node:test";
import { accountSource, grantsAdmin, shouldAutoApprove, signUpRefusal, trustedForAdminList } from "./approval-policy";

const base = { emailVerified: false, isAdminEmail: false, allowedDomains: ["example.com"] };

test("the public sign-up endpoint is always a sign-up, whatever the body claims", () => {
  assert.equal(accountSource("/sign-up/email", "admin"), "sign_up");
  assert.equal(accountSource("/sign-up/email", "setup"), "sign_up");
  assert.equal(accountSource("/callback/google", undefined), "google");
  assert.equal(accountSource(undefined, "admin"), "admin");
  assert.equal(accountSource(undefined, "setup"), "setup");
  assert.equal(accountSource(undefined, undefined), "sign_up");
  assert.equal(accountSource("/some/other", "admin"), "sign_up");
});

test("email and password sign-ups never auto-approve, even with an admin email", () => {
  assert.equal(shouldAutoApprove({ ...base, source: "sign_up" }), false);
  assert.equal(shouldAutoApprove({ ...base, source: "sign_up", isAdminEmail: true, emailVerified: true }), false);
});

test("email and password sign-ups never grant admin", () => {
  assert.equal(grantsAdmin({ source: "sign_up", emailVerified: true, isAdminEmail: true }), false);
  assert.equal(trustedForAdminList("sign_up"), false);
});

test("sign-up is refused for admin-listed emails and when no domain is set", () => {
  assert.equal(signUpRefusal({ source: "sign_up", isAdminEmail: true, allowedDomains: ["example.com"] }), "admin_email");
  assert.equal(signUpRefusal({ source: "sign_up", isAdminEmail: false, allowedDomains: [] }), "sign_up_closed");
  assert.equal(signUpRefusal({ source: "sign_up", isAdminEmail: false, allowedDomains: ["example.com"] }), null);
  assert.equal(signUpRefusal({ source: "google", isAdminEmail: true, allowedDomains: [] }), null);
});

test("verified Google is approved with an allowed domain, or when the email is a listed admin", () => {
  assert.equal(shouldAutoApprove({ ...base, source: "google", emailVerified: true }), true);
  assert.equal(shouldAutoApprove({ ...base, source: "google", emailVerified: true, allowedDomains: [] }), false);
  assert.equal(shouldAutoApprove({ ...base, source: "google", emailVerified: true, allowedDomains: [], isAdminEmail: true }), true);
  assert.equal(shouldAutoApprove({ ...base, source: "google", emailVerified: false, isAdminEmail: true }), false);
  assert.equal(grantsAdmin({ source: "google", emailVerified: true, isAdminEmail: true }), true);
  assert.equal(grantsAdmin({ source: "google", emailVerified: false, isAdminEmail: true }), false);
});

test("admin-created and setup accounts are approved; setup is admin", () => {
  assert.equal(shouldAutoApprove({ ...base, source: "admin" }), true);
  assert.equal(shouldAutoApprove({ ...base, source: "setup" }), true);
  assert.equal(grantsAdmin({ source: "setup", emailVerified: false, isAdminEmail: false }), true);
  assert.equal(grantsAdmin({ source: "admin", emailVerified: false, isAdminEmail: false }), false);
  assert.equal(trustedForAdminList("admin"), true);
  assert.equal(trustedForAdminList(null), true);
});
