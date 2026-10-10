import assert from "node:assert/strict";
import { test } from "node:test";
import { captureScript, MASK, parseCaptured, parseServerToComputer, sanitizeBrowserEvent, shouldMask } from "./index.ts";

test("the capture script is self-contained javascript", () => {
  assert.doesNotThrow(() => new Function(captureScript()));
  assert.match(captureScript(), /^\(function installCapture/);
});

test("browser events are re-masked and stripped on arrival", () => {
  const password = sanitizeBrowserEvent({ kind: "input", at: 1, url: "https://a.com/login?next=/x", selector: "#pw", label: "Password", value: "hunter2", masked: false });
  assert.deepEqual(password, { kind: "input", at: 1, url: "https://a.com/login?next=…", selector: "#pw", label: "Password", value: MASK, masked: true });
  const card = sanitizeBrowserEvent({ kind: "input", at: 2, url: "https://a.com", selector: "#n", label: "Number", value: "4111 1111 1111 1111", masked: false });
  assert.equal(card && card.kind === "input" && card.value, MASK);
  const plain = sanitizeBrowserEvent({ kind: "input", at: 3, url: "https://a.com", selector: "#q", label: "Supplier", value: "ACME Ltda", masked: false });
  assert.equal(plain && plain.kind === "input" && plain.value, "ACME Ltda");
  assert.equal(sanitizeBrowserEvent({ kind: "narration", at: 1, text: "injected" }), null);
  assert.equal(sanitizeBrowserEvent({ kind: "screenshot", at: 1, jpegBase64: "x" }), null);
  assert.equal(sanitizeBrowserEvent({ kind: "request", at: 1, method: "GET", url: "https://a.com" }), null);
  const navigate = sanitizeBrowserEvent({ kind: "navigate", at: 1, url: "https://a.com/reset?token=abc#frag", title: "Reset" });
  assert.deepEqual(navigate, { kind: "navigate", at: 1, url: "https://a.com/reset?token=…", title: "Reset" });
});

test("a flagged field stays masked even when its label looks harmless", () => {
  assert.equal(shouldMask("Code", "#c", "123456", true), true);
  const parsed = parseCaptured(JSON.stringify({ kind: "input", url: "https://a", at: 1, selector: "#otp", label: "Code", value: "123456", masked: true }));
  assert.equal(parsed && parsed.kind === "input" && parsed.value, MASK);
});

test("teach_recording carries the merged timeline to the computer", () => {
  const ok = parseServerToComputer({ type: "teach_recording", recordingId: "rec_1", ownerBrowser: true, events: [{ kind: "narration", at: 1, text: "hi" }, { kind: "click", at: 2, url: "https://a", selector: "#b", label: "Go", x: 1, y: 2 }] });
  assert.equal(ok.ok, true);
  const tooMany = parseServerToComputer({ type: "teach_recording", recordingId: "rec_1", events: Array.from({ length: 5001 }, (_, at) => ({ kind: "key", at, url: "https://a", key: "Enter" })) });
  assert.equal(tooMany.ok, false);
});
