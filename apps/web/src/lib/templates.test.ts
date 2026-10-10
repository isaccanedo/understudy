import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRecipe } from "@understudy/protocol";
import { fillPlaceholders, recipeForTemplate, templatePlaceholders } from "./templates";

const recipe = normalizeRecipe({
  title: "Invoice {client}",
  trigger: "Every Monday",
  steps: [
    { text: "Open {portal URL}", detail: "log in as {Client}" },
    { text: "Send the invoice to {email}", mode: "auto" },
  ],
  questions: [{ text: "Which bank?", options: ["A", "B"], answer: "A" }],
  askFirstRuns: 0,
});

test("placeholders are found once each, whatever their case", () => {
  assert.deepEqual(templatePlaceholders(recipe), ["client", "portal URL", "email"]);
});

test("a template drops the owner's answers and keeps the safety defaults", () => {
  const template = recipeForTemplate(recipe);
  assert.equal(template.questions[0].answer, undefined);
  assert.equal(template.askFirstRuns, 3);
  assert.equal(template.steps[1].mode, "ask");
});

test("installing fills the given values and leaves the rest as placeholders", () => {
  const filled = fillPlaceholders(recipeForTemplate(recipe), { client: "Acme", "PORTAL url": "https://acme.example" });
  assert.equal(filled.title, "Invoice Acme");
  assert.equal(filled.steps[0].text, "Open https://acme.example");
  assert.equal(filled.steps[0].detail, "log in as Acme");
  assert.equal(filled.steps[1].text, "Send the invoice to {email}");
  assert.equal(filled.steps[1].mode, "ask");
  assert.equal(filled.askFirstRuns, 3);
});
