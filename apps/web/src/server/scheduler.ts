import { Cron } from "croner";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Hub } from "./hub";

const SYNC_INTERVAL_MS = 30_000;

type Job = { cron: Cron; signature: string };

export function isValidCron(expression: string, timezone = "UTC") {
  try {
    const job = new Cron(expression, { timezone, paused: true });
    const next = job.nextRun();
    job.stop();
    return next !== null;
  } catch {
    return false;
  }
}

export function nextRunAt(expression: string, timezone: string) {
  try {
    const job = new Cron(expression, { timezone, paused: true });
    const next = job.nextRun();
    job.stop();
    return next;
  } catch {
    return null;
  }
}

export class Scheduler {
  private jobs = new Map<string, Job>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private hub: Hub) {}

  start() {
    this.sync().catch((error) => console.error("scheduler_sync_error", error));
    this.timer = setInterval(() => {
      this.sync().catch((error) => console.error("scheduler_sync_error", error));
    }, SYNC_INTERVAL_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const job of this.jobs.values()) job.cron.stop();
    this.jobs.clear();
  }

  async sync() {
    const db = getDb();
    const rows = await db
      .select({ id: schema.recipes.id, cron: schema.recipes.cron, timezone: schema.recipes.timezone })
      .from(schema.recipes)
      .where(and(eq(schema.recipes.active, true), isNotNull(schema.recipes.cron)));
    const wanted = new Map(rows.filter((r) => r.cron).map((r) => [r.id, `${r.cron}|${r.timezone}`]));

    for (const [id, job] of this.jobs) {
      if (wanted.get(id) !== job.signature) {
        job.cron.stop();
        this.jobs.delete(id);
      }
    }

    for (const row of rows) {
      if (!row.cron || this.jobs.has(row.id)) continue;
      const signature = `${row.cron}|${row.timezone}`;
      try {
        const cron = new Cron(row.cron, { timezone: row.timezone, protect: true }, () => this.fire(row.id));
        this.jobs.set(row.id, { cron, signature });
      } catch (error) {
        console.error(JSON.stringify({ event: "scheduler_invalid_cron", recipeId: row.id, cron: row.cron, error: String(error) }));
      }
    }
  }

  private async fire(recipeId: string) {
    const scheduledFor = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const result = await this.hub.startRun(recipeId, "schedule", { scheduledFor });
    console.log(JSON.stringify({ at: new Date().toISOString(), event: "scheduler_fired", recipeId, ...result }));
  }
}
