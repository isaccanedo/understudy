import { randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isAdmin } from "@/lib/env";
import { hashToken, newId } from "@/lib/ids";

export const PAIR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIR_CODE_LENGTH = 8;
export const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;

export type ExtensionUser = { id: string; name: string; email: string; admin: boolean; tokenId: string };

export function newPairCode(bytes: Buffer = randomBytes(PAIR_CODE_LENGTH)) {
  const chars = Array.from(bytes.subarray(0, PAIR_CODE_LENGTH), (byte) => PAIR_CODE_ALPHABET[byte % PAIR_CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function normalizePairCode(input: string) {
  const flat = input.toUpperCase().replace(/[\s-]/g, "");
  if (flat.length !== PAIR_CODE_LENGTH) return null;
  for (const char of flat) if (!PAIR_CODE_ALPHABET.includes(char)) return null;
  return `${flat.slice(0, 4)}-${flat.slice(4)}`;
}

export function newExtensionToken() {
  return `uxt_${randomBytes(32).toString("base64url")}`;
}

export async function createPairCode(userId: string, now = new Date()) {
  const code = newPairCode();
  const expiresAt = new Date(now.getTime() + PAIR_CODE_TTL_MS);
  const db = getDb();
  await db.delete(schema.extensionPairCodes).where(lt(schema.extensionPairCodes.expiresAt, now));
  await db
    .insert(schema.extensionPairCodes)
    .values({ codeHash: hashToken(code), userId, expiresAt })
    .onConflictDoUpdate({ target: schema.extensionPairCodes.userId, set: { codeHash: hashToken(code), expiresAt } });
  return { code, expiresAt };
}

export async function redeemPairCode(input: string, label: string, now = new Date()) {
  const code = normalizePairCode(input);
  if (!code) return null;
  const db = getDb();
  const [claimed] = await db.delete(schema.extensionPairCodes).where(eq(schema.extensionPairCodes.codeHash, hashToken(code))).returning();
  if (!claimed || claimed.expiresAt < now) return null;
  const [owner] = await db.select().from(schema.user).where(eq(schema.user.id, claimed.userId));
  if (!owner || owner.status !== "approved" || owner.mustChangePassword) return null;
  const token = newExtensionToken();
  const id = newId("ext");
  await db.insert(schema.extensionTokens).values({ id, userId: owner.id, tokenHash: hashToken(token), label: label.slice(0, 120) });
  return { token, tokenId: id, user: { id: owner.id, name: owner.name, email: owner.email } };
}

export async function authenticateExtension(authorization: string | undefined, now = new Date()): Promise<ExtensionUser | null> {
  const token = authorization?.match(/^Bearer\s+(uxt_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!token) return null;
  const db = getDb();
  const [row] = await db
    .select({ token: schema.extensionTokens, user: schema.user })
    .from(schema.extensionTokens)
    .innerJoin(schema.user, eq(schema.user.id, schema.extensionTokens.userId))
    .where(eq(schema.extensionTokens.tokenHash, hashToken(token)));
  if (!row || row.user.status !== "approved" || row.user.mustChangePassword) return null;
  if (now.getTime() - row.token.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await db.update(schema.extensionTokens).set({ lastUsedAt: now }).where(eq(schema.extensionTokens.id, row.token.id));
  }
  return { id: row.user.id, name: row.user.name, email: row.user.email, admin: isAdmin(row.user.email, row.user.admin, row.user.source), tokenId: row.token.id };
}

export async function listExtensionTokens(userId: string) {
  return getDb()
    .select({ id: schema.extensionTokens.id, label: schema.extensionTokens.label, createdAt: schema.extensionTokens.createdAt, lastUsedAt: schema.extensionTokens.lastUsedAt })
    .from(schema.extensionTokens)
    .where(eq(schema.extensionTokens.userId, userId))
    .orderBy(schema.extensionTokens.createdAt);
}

export async function revokeExtensionToken(userId: string, tokenId: string) {
  const removed = await getDb()
    .delete(schema.extensionTokens)
    .where(and(eq(schema.extensionTokens.id, tokenId), eq(schema.extensionTokens.userId, userId)))
    .returning({ id: schema.extensionTokens.id });
  return removed.length > 0;
}
