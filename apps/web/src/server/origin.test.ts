import assert from "node:assert/strict";
import { test } from "node:test";
import { originAllowed } from "./origin";

test("viewer socket accepts only the panel's own origin", () => {
  assert.equal(originAllowed("https://bot.example.com", "https://bot.example.com"), true);
  assert.equal(originAllowed("https://bot.example.com", "https://bot.example.com/"), true);
  assert.equal(originAllowed("https://evil.example.com", "https://bot.example.com"), false);
  assert.equal(originAllowed("http://bot.example.com", "https://bot.example.com"), false);
  assert.equal(originAllowed("null", "https://bot.example.com"), false);
});
