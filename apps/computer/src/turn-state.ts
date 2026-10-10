import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type TurnMode = "idle" | "chat" | "recipe" | "run";

export type TurnState = {
  mode: TurnMode;
  runId?: string;
  approvalsRequired?: boolean;
  askSteps?: { id: string; text: string }[];
};

export function turnStateFile(home: string): string {
  return join(home, ".understudy", "turn.json");
}

export function writeTurnState(file: string, state: TurnState): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const scratch = `${file}.${process.pid}.tmp`;
  writeFileSync(scratch, JSON.stringify(state), { mode: 0o600 });
  renameSync(scratch, file);
}

export function readTurnState(file: string): TurnState {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed.mode === "string") return parsed;
  } catch {}
  return { mode: "chat" };
}
