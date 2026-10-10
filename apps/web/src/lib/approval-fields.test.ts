import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyFields, fieldDisplay, isOffRecipe } from "./approval-fields";

test("an approval for an action outside the task is flagged", () => {
  assert.equal(isOffRecipe([{ label: "Step", value: "Not a step of the recipe" }, { label: "Page", value: "https://x.example" }]), true);
  assert.equal(isOffRecipe([{ label: "Step", value: "Send the invoice" }]), false);
  assert.equal(isOffRecipe([{ label: "Step", value: "Asked in chat" }]), false);
  assert.equal(isOffRecipe([{ label: "note", value: "Not a step of the recipe" }]), false);
});

test("empty form values are shown as empty and called out, masked ones are kept", () => {
  const fields = [
    { label: "Step", value: "Pay the supplier" },
    { label: "Page", value: "https://bank.example/pay" },
    { label: "Supplier", value: "" },
    { label: "Amount (USD)", value: "  " },
    { label: "PIN", value: "••••••" },
  ];
  assert.deepEqual(emptyFields(fields), ["Supplier", "Amount (USD)"]);
  assert.equal(fieldDisplay(""), null);
  assert.equal(fieldDisplay("••••••"), "••••••");
});
