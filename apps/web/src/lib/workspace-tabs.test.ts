import assert from "node:assert/strict";
import { test } from "node:test";
import { advancedTabs, agentTabPath, barTabs, panelTabs, parseView, tabSearch, tabsFor } from "./workspace-tabs";

test("an owner can open every tab", () => {
  assert.equal(parseView("terminal", true), "terminal");
  assert.equal(parseView("settings", true), "settings");
  assert.equal(parseView("computer", true), "computer");
  assert.equal(tabsFor(true).length, 9);
});

test("a teammate only gets the computer, the artifacts and the tasks", () => {
  assert.equal(parseView("tasks", false), "tasks");
  assert.equal(parseView("artifacts", false), "artifacts");
  assert.equal(parseView("computer", false), "computer");
  assert.equal(parseView("terminal", false), "card");
  assert.equal(parseView("logins", false), "card");
});

test("an unknown or missing tab lands on the agent card", () => {
  assert.equal(parseView(null, true), "card");
  assert.equal(parseView("nope", true), "card");
});

test("the card keeps the address clean and other params survive", () => {
  assert.equal(tabSearch("", "card"), "");
  assert.equal(tabSearch("?tab=files", "card"), "");
  assert.equal(tabSearch("?tab=files&x=1", "jobs"), "?tab=jobs&x=1");
  assert.equal(tabSearch("x=1", "card"), "?x=1");
  assert.equal(tabSearch("", "computer"), "?tab=computer");
});

test("the old pages redirect into their tab", () => {
  assert.equal(agentTabPath("agt_1", "terminal"), "/agents/agt_1?tab=terminal");
  assert.equal(agentTabPath("agt_1", "computer"), "/agents/agt_1?tab=computer");
  assert.equal(agentTabPath("agt_1", "card"), "/agents/agt_1");
});

test("the computer opens in its own frame, never in the panel tabs", () => {
  assert.equal(panelTabs(true).includes("computer"), false);
  assert.deepEqual(panelTabs(false), ["artifacts", "tasks"]);
});

test("the terminal stays out of the tab bar and lives under More", () => {
  assert.equal(barTabs(true, "files").includes("terminal"), false);
  assert.deepEqual(advancedTabs(true), ["terminal"]);
  assert.equal(barTabs(true, "files").length, 7);
});

test("an open terminal shows in the bar so the page still says where you are", () => {
  assert.equal(barTabs(true, "terminal").includes("terminal"), true);
});

test("a teammate gets no advanced tools", () => {
  assert.deepEqual(advancedTabs(false), []);
  assert.deepEqual(barTabs(false, "tasks"), ["artifacts", "tasks"]);
});
