import { createHash, timingSafeEqual } from "node:crypto";

export function sameSecret(given: string, expected: string) {
  const left = createHash("sha256").update(given).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
