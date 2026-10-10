import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Hub } from "./hub";

const TICK_MS = 30_000;
const IN_FLIGHT_MS = 2 * 60_000;
const CHANGE_LIMIT = 8000;
export { WATCH_INTERVALS } from "@/lib/watch";
export const MAX_STORED_TEXT = 60 * 1024;

export function describeChange(url: string, before: string, after: string): string {
  const oldLines = before.split("\n").filter(Boolean);
  const newLines = after.split("\n").filter(Boolean);
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const added = newLines.filter((line) => !oldSet.has(line));
  const removed = oldLines.filter((line) => !newSet.has(line));
  const parts = [`The page ${url} changed.`];
  if (added.length) parts.push(`Added:\n${added.map((line) => `+ ${line}`).join("\n")}`);
  if (removed.length) parts.push(`Removed:\n${removed.map((line) => `- ${line}`).join("\n")}`);
  if (!added.length && !removed.length) parts.push("The same lines are there, in a different order.");
  const text = parts.join("\n\n");
  return text.length > CHANGE_LIMIT ? `${text.slice(0, CHANGE_LIMIT)}\n(cut)` : text;
}

export class Watcher {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = new Map<string, number>();

  constructor(private hub: Hub) {}

  start() {
    this.timer = setInterval(() => {
      this.tick().catch((error) => console.error("watcher_tick_error", error));
    }, TICK_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    const due = await getDb()
      .select({ recipeId: schema.recipeWatches.recipeId, agentId: schema.recipeWatches.agentId, url: schema.recipeWatches.url, part: schema.recipeWatches.part })
      .from(schema.recipeWatches)
      .innerJoin(schema.recipes, eq(schema.recipes.id, schema.recipeWatches.recipeId))
      .where(
        and(
          eq(schema.recipes.active, true),
          or(isNull(schema.recipeWatches.checkedAt), lt(schema.recipeWatches.checkedAt, sql`${now.toISOString()}::timestamptz - make_interval(mins => ${schema.recipeWatches.everyMinutes})`)),
        ),
      )
      .limit(200);
    for (const watch of due) {
      const started = this.inFlight.get(watch.recipeId);
      if (started && now.getTime() - started < IN_FLIGHT_MS) continue;
      if (!this.hub.isOnline(watch.agentId)) continue;
      const sent = this.hub.sendToComputer(watch.agentId, { type: "watch_check", watchId: watch.recipeId, url: watch.url, ...(watch.part ? { part: watch.part } : {}) });
      if (!sent) continue;
      this.inFlight.set(watch.recipeId, now.getTime());
      await getDb().update(schema.recipeWatches).set({ checkedAt: now }).where(eq(schema.recipeWatches.recipeId, watch.recipeId));
    }
  }

  async result(agentId: string, message: { watchId: string; hash?: string; text?: string; error?: string }) {
    this.inFlight.delete(message.watchId);
    const db = getDb();
    const [watch] = await db
      .select()
      .from(schema.recipeWatches)
      .where(and(eq(schema.recipeWatches.recipeId, message.watchId), eq(schema.recipeWatches.agentId, agentId)));
    if (!watch) return { kind: "unknown" as const };
    if (message.error || !message.hash || message.text === undefined) {
      await db.update(schema.recipeWatches).set({ lastError: (message.error ?? "no answer").slice(0, 500) }).where(eq(schema.recipeWatches.recipeId, watch.recipeId));
      return { kind: "error" as const };
    }
    const text = message.text.slice(0, MAX_STORED_TEXT);
    if (watch.lastHash === null) {
      await db.update(schema.recipeWatches).set({ lastHash: message.hash, lastText: text, lastError: null }).where(eq(schema.recipeWatches.recipeId, watch.recipeId));
      return { kind: "baseline" as const };
    }
    if (watch.lastHash === message.hash) {
      await db.update(schema.recipeWatches).set({ lastError: null }).where(eq(schema.recipeWatches.recipeId, watch.recipeId));
      return { kind: "same" as const };
    }
    const updated = await db
      .update(schema.recipeWatches)
      .set({ lastHash: message.hash, lastText: text, lastError: null, changedAt: new Date() })
      .where(and(eq(schema.recipeWatches.recipeId, watch.recipeId), eq(schema.recipeWatches.lastHash, watch.lastHash)))
      .returning({ recipeId: schema.recipeWatches.recipeId });
    if (!updated.length) return { kind: "same" as const };
    const started = await this.hub.startRun(watch.recipeId, "watch", { input: describeChange(watch.url, watch.lastText ?? "", text) });
    return { kind: "changed" as const, started };
  }
}
