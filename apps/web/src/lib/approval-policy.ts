export type AccountSource = "sign_up" | "google" | "admin" | "setup";

const vouchedSources = new Set<string>(["admin", "setup"]);

export function accountSource(path: string | undefined, preset: unknown): AccountSource {
  if (path === "/sign-up/email") return "sign_up";
  if (path?.startsWith("/callback/") || path === "/sign-in/social") return "google";
  if (!path && typeof preset === "string" && vouchedSources.has(preset)) return preset as AccountSource;
  return "sign_up";
}

export function signUpRefusal(input: { source: AccountSource; isAdminEmail: boolean; allowedDomains: string[] }) {
  if (input.source !== "sign_up") return null;
  if (input.allowedDomains.length === 0) return "sign_up_closed" as const;
  if (input.isAdminEmail) return "admin_email" as const;
  return null;
}

export function shouldAutoApprove(input: { source: AccountSource; emailVerified: boolean; isAdminEmail: boolean; allowedDomains: string[] }) {
  if (vouchedSources.has(input.source)) return true;
  if (input.source === "google" && input.emailVerified) return input.allowedDomains.length > 0 || input.isAdminEmail;
  return false;
}

export function grantsAdmin(input: { source: AccountSource; emailVerified: boolean; isAdminEmail: boolean }) {
  if (input.source === "setup") return true;
  if (input.source === "admin") return input.isAdminEmail;
  if (input.source === "google") return input.emailVerified && input.isAdminEmail;
  return false;
}

export function trustedForAdminList(source: string | null | undefined) {
  return source !== "sign_up";
}
