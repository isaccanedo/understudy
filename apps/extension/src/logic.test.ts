import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFor, errorText } from "./copy.ts";
import { apiError, clock, elapsedMs, EventBuffer, fromIndicator, idleSession, INDICATOR_ID, isRecordableUrl, lastNavigation, normalizeServerUrl } from "./logic.ts";

test("panel addresses are normalized to an https origin, http only for localhost", () => {
  assert.equal(normalizeServerUrl("bot.example.com/agents"), "https://bot.example.com");
  assert.equal(normalizeServerUrl("https://bot.example.com/"), "https://bot.example.com");
  assert.equal(normalizeServerUrl("http://localhost:3100/x"), "http://localhost:3100");
  assert.equal(normalizeServerUrl("http://panel.localhost:3100"), "http://panel.localhost:3100");
  assert.equal(normalizeServerUrl("http://bot.example.com"), null);
  assert.equal(normalizeServerUrl("javascript:alert(1)"), null);
  assert.equal(normalizeServerUrl("  "), null);
});

test("only regular web pages outside the panel are recorded", () => {
  assert.equal(isRecordableUrl("https://bank.example.com/statements", "https://bot.example.com"), true);
  assert.equal(isRecordableUrl("https://bot.example.com/agents/1", "https://bot.example.com"), false);
  assert.equal(isRecordableUrl("chrome://extensions", ""), false);
  assert.equal(isRecordableUrl("chrome-extension://abc/popup.html", ""), false);
  assert.equal(isRecordableUrl("file:///Users/me/secret.pdf", ""), false);
  assert.equal(isRecordableUrl(undefined, ""), false);
});

test("clicks on the recording indicator are never recorded", () => {
  assert.equal(fromIndicator(JSON.stringify({ kind: "click", selector: `#${INDICATOR_ID}` })), true);
  assert.equal(fromIndicator(JSON.stringify({ kind: "click", selector: "#save" })), false);
  assert.equal(fromIndicator("not json"), false);
});

test("the timer leaves out paused time", () => {
  const session = { ...idleSession(), phase: "paused" as const, startedAt: 1_000, pausedMs: 2_000, pausedAt: 8_000 };
  assert.equal(elapsedMs(session, 10_000), 5_000);
  assert.equal(elapsedMs({ ...session, phase: "recording", pausedAt: null }, 10_000), 7_000);
  assert.equal(clock(65_400), "01:05");
});

test("the event buffer hands out batches and caps its size", () => {
  const buffer = new EventBuffer<number>(3);
  assert.equal(buffer.push(1), true);
  buffer.push(2);
  buffer.push(3);
  assert.equal(buffer.push(4), false);
  assert.deepEqual(buffer.take(2), [1, 2]);
  buffer.drop(2);
  assert.deepEqual(buffer.take(), [3]);
});

test("a tab's navigation is noted once per address", () => {
  const navigation = lastNavigation();
  assert.equal(navigation.changed(1, "https://a.com/"), true);
  assert.equal(navigation.changed(1, "https://a.com/"), false);
  assert.equal(navigation.changed(2, "https://a.com/"), true);
  navigation.forget(1);
  assert.equal(navigation.changed(1, "https://a.com/"), true);
});

test("errors from the panel become plain sentences in the browser's language", () => {
  assert.equal(apiError(401, {}), "unauthorized");
  assert.equal(apiError(400, { error: "invalid_code" }), "invalid_code");
  assert.equal(apiError(500, null), "http_500");
  assert.match(errorText("invalid_code", copyFor("en-US")), /10 minutes/);
  assert.match(errorText("invalid_code", copyFor("pt-BR")), /10 minutos/);
  assert.equal(errorText("http_418", copyFor("en")), copyFor("en").errors.unknown);
  assert.equal(errorText(null), "");
});
