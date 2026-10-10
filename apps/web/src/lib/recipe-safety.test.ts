import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRecipe } from "@understudy/protocol";

test("an owner edit cannot turn an irreversible step into an automatic one", () => {
  const recipe = normalizeRecipe({
    title: "Invoices",
    trigger: "x",
    askFirstRuns: 0,
    steps: [
      { id: "s1", text: "Open the portal", mode: "auto" },
      { id: "s2", text: "Click Issue invoice", mode: "auto" },
    ],
    questions: [],
  });
  assert.equal(recipe.steps[0].mode, "auto");
  assert.equal(recipe.steps[1].mode, "ask");
});

test("recipes are capped", () => {
  const recipe = normalizeRecipe({
    title: "t".repeat(1000),
    trigger: "x",
    askFirstRuns: 9999,
    steps: Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, text: `step ${i}`, mode: "auto" })),
    questions: [],
  });
  assert.equal(recipe.title.length, 200);
  assert.equal(recipe.askFirstRuns, 100);
  assert.equal(recipe.steps.length, 100);
});
