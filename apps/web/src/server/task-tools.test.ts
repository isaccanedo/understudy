import assert from "node:assert/strict";
import { test } from "node:test";
import { taskTools } from "./task-tools";

const saveTask = () => taskTools({ recordings: {} } as never, { id: "agt_x" }).find((tool) => tool.name === "save_task")!;

test("save_task tells the brain that memory notes are not tasks and that it must not claim a task is already saved", () => {
  const tool = saveTask();
  assert.match(tool.description, /notes or files in ~\/memory are not tasks/);
  assert.match(tool.description, /never say it is already saved/);
  assert.match(tool.description, /paused/);
});

test("save_task refuses an empty description", () => {
  const tool = saveTask();
  assert.equal(tool.schema.safeParse({ description: "   " }).success, false);
  assert.equal(tool.schema.safeParse({}).success, false);
  assert.equal(tool.schema.safeParse({ description: "Download the weekly sales report" }).success, true);
});
