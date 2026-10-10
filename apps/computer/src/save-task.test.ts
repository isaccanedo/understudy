import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTool, SYSTEM_PROMPT } from "./agent.ts";

test("the brain is told that only save_task creates a task and never to claim one was saved without it", () => {
  assert.match(SYSTEM_PROMPT, /save_task/);
  assert.match(SYSTEM_PROMPT, /Writing a note, a skill or a file in ~\/memory never creates a task/);
  assert.match(SYSTEM_PROMPT, /Never tell your owner a task was saved unless save_task accepted it/);
  assert.match(SYSTEM_PROMPT, /Or describe it/);
});

test("the owner sees a plain line when the brain saves a task", () => {
  assert.equal(describeTool("mcp__gatekeeper__save_task", { description: "Every Monday, file the invoices" }), "Saving this as a task");
});
