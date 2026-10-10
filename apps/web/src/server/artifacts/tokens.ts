import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CONTENT_TOKEN_SECONDS = 60 * 60;
export const SHARE_LINK_DAYS = 30;

function key() {
  const secret = process.env.UNDERSTUDY_SECRET_KEY?.trim() || process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) throw new Error("UNDERSTUDY_SECRET_KEY or BETTER_AUTH_SECRET must be set");
  return createHash("sha256").update(`${secret}:understudy-artifact-content`).digest();
}

const VERSION_ID = /^arv_[A-Za-z0-9_-]{6,80}$/;

function sign(payload: string) {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function contentToken(versionId: string, now = Date.now(), seconds = CONTENT_TOKEN_SECONDS) {
  if (!VERSION_ID.test(versionId)) throw new Error("invalid artifact version id");
  const payload = `${versionId}.${Math.floor(now / 1000) + seconds}`;
  return `${payload}.${sign(payload)}`;
}

export function readContentToken(token: string, now = Date.now()): string | null {
  if (typeof token !== "string" || token.length > 300) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [versionId, expires, signature] = parts;
  if (!VERSION_ID.test(versionId) || !/^\d{1,12}$/.test(expires)) return null;
  const expected = Buffer.from(sign(`${versionId}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(expires) * 1000 < now) return null;
  return versionId;
}

export function newShareToken() {
  return randomBytes(24).toString("base64url");
}

export function shareTokenHash(token: string) {
  return createHash("sha256").update(`understudy-artifact-link:${token}`).digest("hex");
}

export function validShareToken(token: string) {
  return /^[A-Za-z0-9_-]{32}$/.test(token);
}
