import { randomBytes } from "node:crypto";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function inboundLocalPart(title: string, random: Buffer = randomBytes(10)) {
  const slug =
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "task";
  const suffix = [...random.subarray(0, 10)].map((byte) => BASE32[byte % 32]).join("");
  return `${slug}.${suffix}`;
}

export function cleanSenderList(value: string) {
  const entries = value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter((entry) => /^([^@\s]+@)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(entry));
  return [...new Set(entries)].slice(0, 50).join(", ");
}
