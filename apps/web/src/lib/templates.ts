import { DEFAULT_ASK_FIRST_RUNS, normalizeRecipe, type Recipe } from "@understudy/protocol";

const PLACEHOLDER = /\{([^{}\n]{1,60})\}/g;

function texts(recipe: Recipe) {
  return [recipe.title, recipe.trigger, ...recipe.steps.flatMap((step) => [step.text, step.detail ?? ""]), ...recipe.questions.flatMap((q) => [q.text, ...q.options])];
}

export function templatePlaceholders(recipe: Recipe) {
  const found = new Map<string, string>();
  for (const text of texts(recipe)) {
    for (const match of text.matchAll(PLACEHOLDER)) {
      const name = match[1].trim();
      if (name && !found.has(name.toLowerCase())) found.set(name.toLowerCase(), name);
    }
  }
  return [...found.values()].slice(0, 30);
}

export function recipeForTemplate(recipe: Recipe): Recipe {
  const clean = normalizeRecipe(recipe);
  return {
    ...clean,
    questions: clean.questions.map((q) => ({ id: q.id, text: q.text, options: q.options })),
    askFirstRuns: DEFAULT_ASK_FIRST_RUNS,
  };
}

export function fillPlaceholders(recipe: Recipe, values: Record<string, string>): Recipe {
  const lookup = new Map(Object.entries(values).map(([key, value]) => [key.trim().toLowerCase(), value.trim()]));
  const fill = (text: string) =>
    text.replace(PLACEHOLDER, (whole, name: string) => {
      const value = lookup.get(name.trim().toLowerCase());
      return value ? value.slice(0, 300) : whole;
    });
  return normalizeRecipe({
    ...recipe,
    title: fill(recipe.title),
    trigger: fill(recipe.trigger),
    steps: recipe.steps.map((step) => ({ ...step, text: fill(step.text), detail: step.detail ? fill(step.detail) : undefined })),
    questions: recipe.questions.map((q) => ({ ...q, text: fill(q.text), options: q.options.map(fill) })),
    askFirstRuns: DEFAULT_ASK_FIRST_RUNS,
  });
}
