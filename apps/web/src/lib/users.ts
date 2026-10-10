import { randomBytes } from "node:crypto";
import { getAuth } from "./auth";
import { getDb, schema } from "./db";
import { env, isAllowedEmail } from "./env";

export function temporaryPassword() {
  return randomBytes(9).toString("base64url");
}

export function bootstrapAllowed() {
  return env.adminEmails.length === 0;
}

export async function hasAnyUser() {
  return (await getDb().select({ id: schema.user.id }).from(schema.user).limit(1)).length > 0;
}

export async function createUserWithPassword(input: { email: string; name: string; password: string; mustChangePassword?: boolean; source?: "admin" | "setup" }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("invalid_email");
  if (!isAllowedEmail(email)) throw new Error("domain_not_allowed");
  if (input.password.length < 8) throw new Error("password_too_short");
  const ctx = await getAuth().$context;
  if (await ctx.internalAdapter.findUserByEmail(email)) throw new Error("user_exists");
  const user = await ctx.internalAdapter.createUser({
    email,
    name: input.name.trim() || email.split("@")[0],
    emailVerified: false,
    status: "approved",
    source: input.source ?? "admin",
    mustChangePassword: input.mustChangePassword ?? true,
  }, { method: "admin" });
  if (!user) throw new Error("create_failed");
  await ctx.internalAdapter.linkAccount({
    providerId: "credential",
    accountId: user.id,
    userId: user.id,
    password: await ctx.password.hash(input.password),
  });
  return user;
}
