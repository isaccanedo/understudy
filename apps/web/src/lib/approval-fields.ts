const OFF_RECIPE = "Not a step of the recipe";

export function isOffRecipe(fields: { label: string; value: string }[]) {
  return fields.some((field) => field.label === "Step" && field.value.trim() === OFF_RECIPE);
}

export function fieldDisplay(value: string) {
  return value.trim() ? value : null;
}

export function emptyFields(fields: { label: string; value: string }[]) {
  return fields.filter((field) => field.label !== "Step" && field.label !== "Page" && !field.value.trim()).map((field) => field.label);
}
