export function answeredOutcome(result: { ok: boolean; status?: string | null } | undefined, approved: boolean): string {
  if (result?.ok) return approved ? "approved" : "denied";
  return result?.status ?? "unanswered";
}
