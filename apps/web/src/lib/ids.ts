import { createHash, randomBytes } from "node:crypto";

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

export function newComputerToken() {
  return `ust_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
