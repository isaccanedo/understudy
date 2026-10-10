import { createHash } from "node:crypto";

export const MAX_APPROVAL_FIELDS = 50;
export const MAX_APPROVAL_VALUE = 20000;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function payloadHash(target: string, args: Record<string, unknown>) {
  return createHash("sha256").update(target).update("\n").update(JSON.stringify(stable(args))).digest("hex");
}

export function approvalFields(args: Record<string, unknown>) {
  const entries = Object.entries(args).map(([label, value]) => ({
    label,
    value: typeof value === "string" ? value : JSON.stringify(value, null, 2),
  }));
  if (entries.length > MAX_APPROVAL_FIELDS) return { error: `at most ${MAX_APPROVAL_FIELDS} arguments` } as const;
  if (entries.some((f) => f.label.length > 200 || f.value.length > MAX_APPROVAL_VALUE)) {
    return { error: `each argument must be at most ${MAX_APPROVAL_VALUE} characters` } as const;
  }
  return { fields: entries } as const;
}

export function serverAllowedFor(allowedEmails: string[] | null | undefined, email: string) {
  if (!allowedEmails) return true;
  return allowedEmails.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}
