import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAT_WIDTH, chatRows, clampChatWidth, parseStoredWidth } from "./chat-layout";

const at = (minute: number) => new Date(2026, 9, 7, 10, minute).toISOString();

test("consecutive activity entries collapse into one steps group", () => {
  const rows = chatRows([
    { id: "1", role: "user", text: "go", at: at(0) },
    { id: "2", role: "activity", text: "open", at: at(1) },
    { id: "3", role: "activity", text: "click", at: at(1) },
    { id: "4", role: "agent", text: "done", at: at(2) },
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ["day", "message", "steps", "message"]);
  assert.equal(rows[2].kind === "steps" && rows[2].entries.length, 2);
});

test("a rule block notice between steps stays its own row, never inside a collapsed steps group", () => {
  const rows = chatRows([
    { id: "1", role: "activity", text: "Opening http://pay.test/", at: at(0) },
    { id: "2", role: "system", text: 'Blocked by your rule "Never open pay.test."', at: at(0) },
    { id: "3", role: "activity", text: "Reading the page", at: at(0) },
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ["day", "steps", "message", "steps"]);
  const grouped = rows.flatMap((r) => (r.kind === "steps" ? r.entries.map((e) => e.id) : []));
  assert.deepEqual(grouped, ["1", "3"]);
});

test("messages from the same side within minutes continue the previous one", () => {
  const rows = chatRows([
    { id: "1", role: "agent", text: "a", at: at(0) },
    { id: "2", role: "agent", text: "b", at: at(1) },
    { id: "3", role: "agent", text: "c", at: at(30) },
  ]);
  const continued = rows.flatMap((r) => (r.kind === "message" ? [r.continued] : []));
  assert.deepEqual(continued, [false, true, false]);
});

test("a steps group breaks the continuation", () => {
  const rows = chatRows([
    { id: "1", role: "agent", text: "a", at: at(0) },
    { id: "2", role: "activity", text: "x", at: at(0) },
    { id: "3", role: "agent", text: "b", at: at(1) },
  ]);
  const last = rows[rows.length - 1];
  assert.equal(last.kind === "message" && last.continued, false);
});

test("a new day adds a divider", () => {
  const rows = chatRows([
    { id: "1", role: "user", text: "a", at: new Date(2026, 9, 6, 23, 0).toISOString() },
    { id: "2", role: "user", text: "b", at: new Date(2026, 9, 7, 9, 0).toISOString() },
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ["day", "message", "day", "message"]);
});

test("chat width is clamped and leaves room for the screen", () => {
  assert.equal(clampChatWidth(100), CHAT_WIDTH.min);
  assert.equal(clampChatWidth(5000), CHAT_WIDTH.max);
  assert.equal(clampChatWidth(700, 1000), 640);
  assert.equal(clampChatWidth(Number.NaN), CHAT_WIDTH.fallback);
});

test("stored width ignores garbage", () => {
  assert.equal(parseStoredWidth(null), null);
  assert.equal(parseStoredWidth("abc"), null);
  assert.equal(parseStoredWidth("512"), 512);
});
