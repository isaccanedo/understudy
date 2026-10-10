export const AGENT_TALK_CEILING_ENV = "UNDERSTUDY_AGENT_TALK_CEILING";

export function parseTalkCeiling(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function pastCeiling(depth: number, ceiling: number | null) {
  return ceiling !== null && depth > ceiling;
}

export function pairKey(a: string, b: string) {
  return [a, b].sort() as [string, string];
}
