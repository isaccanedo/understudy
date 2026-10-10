import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Hub } from "../hub";
import { log } from "./shared";

export const IDLE_SLEEP_MS = 30 * 60 * 1000;
const SWEEP_MS = 60 * 1000;
const RESTING_STATES = new Set(["calm", "done"]);

export type IdleSignals = {
  idleMs: number;
  viewers: number;
  recording: boolean;
  runningJobs: number;
  state: string;
  runningRuns: number;
  pendingApprovals: number;
  watches: number;
};

export function shouldSleep(signals: IdleSignals, limitMs = IDLE_SLEEP_MS) {
  if (signals.idleMs < limitMs) return false;
  if (signals.viewers > 0 || signals.recording || signals.runningJobs > 0) return false;
  if (!RESTING_STATES.has(signals.state)) return false;
  return signals.runningRuns === 0 && signals.pendingApprovals === 0 && signals.watches === 0;
}

export class IdleSleeper {
  private lastActive = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private hub: Hub) {}

  start() {
    this.timer = setInterval(() => {
      this.sweep().catch((error) => log("idle_sweep_error", { error: String(error) }));
    }, SWEEP_MS);
    this.timer.unref();
  }

  touch(agentId: string, now = Date.now()) {
    this.lastActive.set(agentId, now);
  }

  forget(agentId: string) {
    this.lastActive.delete(agentId);
  }

  async sweep(now = Date.now()) {
    for (const [agentId, at] of this.lastActive) {
      if (now - at < IDLE_SLEEP_MS || !this.hub.isOnline(agentId)) continue;
      const signals = await this.signals(agentId, now - at);
      if (!signals || !shouldSleep(signals)) continue;
      if (now - (this.lastActive.get(agentId) ?? 0) < IDLE_SLEEP_MS) continue;
      await this.hub.putToSleep(agentId);
      this.lastActive.delete(agentId);
      log("computer_sleeping", { agentId, idleMinutes: Math.round(signals.idleMs / 60000) });
    }
  }

  private async signals(agentId: string, idleMs: number): Promise<IdleSignals | null> {
    const db = getDb();
    const [agent] = await db.select({ state: schema.agents.state }).from(schema.agents).where(eq(schema.agents.id, agentId));
    if (!agent) return null;
    const [[runs], [approvals], [watches]] = await Promise.all([
      db.select({ n: count() }).from(schema.runs).where(and(eq(schema.runs.agentId, agentId), eq(schema.runs.status, "running"))),
      db.select({ n: count() }).from(schema.approvals).where(and(eq(schema.approvals.agentId, agentId), eq(schema.approvals.status, "pending"))),
      db
        .select({ n: count() })
        .from(schema.recipeWatches)
        .innerJoin(schema.recipes, eq(schema.recipes.id, schema.recipeWatches.recipeId))
        .where(and(eq(schema.recipeWatches.agentId, agentId), eq(schema.recipes.active, true))),
    ]);
    return {
      idleMs,
      viewers: this.hub.viewerCount(agentId),
      recording: this.hub.activeRecording(agentId) !== null,
      runningJobs: this.hub.runningJobs(agentId),
      state: agent.state,
      runningRuns: runs.n,
      pendingApprovals: approvals.n,
      watches: watches.n,
    };
  }
}
