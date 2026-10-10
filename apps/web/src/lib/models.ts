export const MODELS = ["opus", "sonnet", "haiku"] as const;

export type ModelChoice = (typeof MODELS)[number];

export function isModel(value: unknown): value is ModelChoice {
  return typeof value === "string" && (MODELS as readonly string[]).includes(value);
}

export function defaultModel(env: Record<string, string | undefined> = process.env): ModelChoice | null {
  const wanted = env.UNDERSTUDY_DEFAULT_MODEL?.trim().toLowerCase();
  return isModel(wanted) ? wanted : null;
}

export function effectiveModel(chosen: string | null | undefined, env: Record<string, string | undefined> = process.env): ModelChoice | null {
  return isModel(chosen) ? chosen : defaultModel(env);
}
