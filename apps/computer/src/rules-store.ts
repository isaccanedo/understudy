import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OwnerRuleSchema, type OwnerRule } from "@understudy/protocol";

export function rulesFile(home: string): string {
  return join(home, ".understudy", "rules.json");
}

export function readRules(file: string): OwnerRule[] {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed.flatMap((rule) => {
      const result = OwnerRuleSchema.safeParse(rule);
      return result.success ? [result.data] : [];
    }) : [];
  } catch {
    return [];
  }
}

export function writeRules(file: string, rules: OwnerRule[]) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(rules), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}
