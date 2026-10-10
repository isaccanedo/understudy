import type { Recipe, RecipeQuestion, RecipeStep } from "./index.ts";
import { looksIrreversible } from "./patterns.ts";

export const DEFAULT_ASK_FIRST_RUNS = 3;

export const RECIPE_LIMITS = {
  title: 200,
  trigger: 300,
  steps: 100,
  stepText: 1000,
  stepDetail: 2000,
  questions: 50,
  questionText: 1000,
  options: 10,
  optionText: 300,
  answer: 1000,
  askFirstRuns: 100,
} as const;

type Options = { requireSteps?: boolean };

const str = (value: unknown) => (value === undefined || value === null ? "" : String(value));

export function normalizeRecipe(raw: unknown, options: Options = {}): Recipe {
  if (!raw || typeof raw !== "object") throw new Error("recipe is not an object");
  const value = raw as Record<string, unknown>;
  const rawSteps = Array.isArray(value.steps) ? value.steps : [];
  const seen = new Set<string>();
  const steps: RecipeStep[] = rawSteps
    .map((entry) => (entry ?? {}) as Record<string, unknown>)
    .filter((step) => str(step.text).trim())
    .slice(0, RECIPE_LIMITS.steps)
    .map((step, index) => {
      const text = str(step.text).trim().slice(0, RECIPE_LIMITS.stepText);
      const detail = str(step.detail).trim().slice(0, RECIPE_LIMITS.stepDetail);
      let stepId = str(step.id).trim().slice(0, 100) || `s${index + 1}`;
      if (seen.has(stepId)) stepId = `s${index + 1}`;
      while (seen.has(stepId)) stepId = `${stepId}-${index + 1}`;
      seen.add(stepId);
      const mode = step.mode === "ask" || looksIrreversible(text) ? "ask" : "auto";
      return { id: stepId, text, ...(detail ? { detail } : {}), mode };
    });
  if (options.requireSteps && !steps.length) throw new Error("recipe has no steps");
  const questions: RecipeQuestion[] = (Array.isArray(value.questions) ? value.questions : [])
    .map((entry) => (entry ?? {}) as Record<string, unknown>)
    .filter((question) => str(question.text).trim())
    .slice(0, RECIPE_LIMITS.questions)
    .map((question, index) => {
      const answer = str(question.answer).trim().slice(0, RECIPE_LIMITS.answer);
      return {
        id: str(question.id).trim().slice(0, 100) || `q${index + 1}`,
        text: str(question.text).trim().slice(0, RECIPE_LIMITS.questionText),
        options: (Array.isArray(question.options) ? question.options : [])
          .map((option) => str(option).trim().slice(0, RECIPE_LIMITS.optionText))
          .filter(Boolean)
          .slice(0, RECIPE_LIMITS.options),
        ...(answer ? { answer } : {}),
      };
    });
  const asked = Number(value.askFirstRuns);
  const askFirstRuns = Number.isFinite(asked) ? Math.max(0, Math.min(RECIPE_LIMITS.askFirstRuns, Math.round(asked))) : DEFAULT_ASK_FIRST_RUNS;
  return {
    title: str(value.title).trim().slice(0, RECIPE_LIMITS.title) || "Untitled task",
    trigger: str(value.trigger).trim().slice(0, RECIPE_LIMITS.trigger) || "when the owner asks",
    steps,
    questions,
    askFirstRuns,
  };
}
