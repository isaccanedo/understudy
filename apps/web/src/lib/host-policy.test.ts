import assert from "node:assert/strict";
import { test } from "node:test";
import { canPlaceOn, hostAdmission, hostName } from "./host-policy";

test("with an allowlist only listed hosts are trusted", () => {
  assert.equal(hostAdmission({ hostId: "a", allowlist: ["a"], known: null, anyTrusted: false }), "trusted");
  assert.equal(hostAdmission({ hostId: "b", allowlist: ["a"], known: { trusted: true }, anyTrusted: true }), "refuse");
});

test("without an allowlist the first host is pinned and later strangers are refused", () => {
  assert.equal(hostAdmission({ hostId: "a", allowlist: [], known: null, anyTrusted: false }), "pin");
  assert.equal(hostAdmission({ hostId: "b", allowlist: [], known: null, anyTrusted: true }), "refuse");
  assert.equal(hostAdmission({ hostId: "a", allowlist: [], known: { trusted: true }, anyTrusted: true }), "trusted");
  assert.equal(hostAdmission({ hostId: "b", allowlist: [], known: { trusted: false }, anyTrusted: true }), "refuse");
});

test("an agent stays on the host it is bound to", () => {
  assert.equal(canPlaceOn(null, "a"), true);
  assert.equal(canPlaceOn("a", "a"), true);
  assert.equal(canPlaceOn("a", "b"), false);
});

test("hostName turns machine ids into something a person can read", () => {
  assert.deepEqual(hostName("ip-10-0-1-23"), { kind: "cloud", ip: "10.0.1.23" });
  assert.deepEqual(hostName("ip-10-0-1-23.ec2.internal"), { kind: "cloud", ip: "10.0.1.23" });
  assert.deepEqual(hostName("understudy-host-1"), { kind: "numbered", n: "1" });
  assert.deepEqual(hostName("host-12"), { kind: "numbered", n: "12" });
  assert.deepEqual(hostName("sams-laptop"), { kind: "raw", id: "sams-laptop" });
});
