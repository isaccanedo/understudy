import { looksIrreversible, type Recipe } from "@understudy/protocol";

export function approvalsRequiredFor(input: { recipe: Recipe; askAlways: boolean; runsDone: number; trigger: string }) {
  if (input.askAlways || input.trigger === "test" || input.trigger === "webhook" || input.trigger === "email" || input.trigger === "handoff" || input.trigger === "watch") return true;
  if (input.runsDone < input.recipe.askFirstRuns) return true;
  return input.recipe.steps.some((step) => step.mode === "ask" && looksIrreversible(`${step.text} ${step.detail ?? ""}`));
}
