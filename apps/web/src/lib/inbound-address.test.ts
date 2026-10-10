import assert from "node:assert/strict";
import { test } from "node:test";
import { inboundLocalParts } from "@/server/inbound-email/policy";
import { cleanSenderList, inboundLocalPart } from "./inbound-address";

test("a task address is readable, random and accepted by the inbound router", () => {
  const local = inboundLocalPart("Emitir Nota Fiscal — Março!");
  assert.match(local, /^emitir-nota-fiscal-marco\.[a-z2-7]{10}$/);
  assert.deepEqual(inboundLocalParts([`Bot <${local}@in.example.com>`], "in.example.com"), [local]);
  assert.match(inboundLocalPart("!!!"), /^task\.[a-z2-7]{10}$/);
  assert.notEqual(inboundLocalPart("x"), inboundLocalPart("x"));
});

test("allowed senders keep only addresses and domains", () => {
  assert.equal(cleanSenderList("@acme.com, boss@corp.com; junk  x@ ACME.com"), "acme.com, boss@corp.com");
  assert.equal(cleanSenderList(""), "");
});
