import { and, eq, inArray, sql } from "drizzle-orm";
import { normalizeRecipe, RUN_RECORD_MAX_SCREENSHOTS, type RunStep, type Usage } from "@understudy/protocol";
import { effectiveModel } from "@/lib/models";
import { approvalsRequiredFor } from "@/lib/run-policy";
import { brainText } from "@/lib/brain-text";
import { getDb, schema } from "@/lib/db";
import type { RunTrigger } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { messages as copy } from "@/lib/messages";
import type { Hub } from "../hub";
import { sendPush } from "../push";
import { finishRunProgress, startRunProgress } from "../slack-threads";
import { log } from "./shared";

export class Runs {
  constructor(private hub: Hub) {}

  async start(recipeId: string, trigger: RunTrigger, options: { scheduledFor?: Date; input?: string } = {}) {
    const { scheduledFor, input } = options;
    const db = getDb();
    const [found] = await db
      .select({ recipe: schema.recipes, ownerStatus: schema.user.status, model: schema.agents.model })
      .from(schema.recipes)
      .innerJoin(schema.agents, eq(schema.agents.id, schema.recipes.agentId))
      .innerJoin(schema.user, eq(schema.user.id, schema.agents.ownerId))
      .where(eq(schema.recipes.id, recipeId));
    if (!found) return { ok: false as const, reason: "not_found" };
    if (found.ownerStatus !== "approved") return { ok: false as const, reason: "owner_inactive" };
    const recipe = found.recipe;
    const runId = newId("run");
    const inserted = await db
      .insert(schema.runs)
      .values({ id: runId, agentId: recipe.agentId, recipeId, trigger, input: input ?? null, scheduledFor: scheduledFor ?? null })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return { ok: false as const, reason: "duplicate" };
    const steps = normalizeRecipe(recipe.recipe);
    const approvalsRequired = approvalsRequiredFor({ recipe: steps, askAlways: recipe.askAlways, runsDone: recipe.runsDone, trigger });
    if (this.hub.isOnline(recipe.agentId)) {
      await this.hub.addMessage(recipe.agentId, "system", copy.runs.started(recipe.recipe.title, trigger), runId);
    }
    const context = [trigger === "test" ? brainText.testContext : "", input ? brainText.runInput(trigger, input) : ""].filter(Boolean).join("\n\n");
    const delivery = await this.hub.deliver(recipe.agentId, {
      type: "run_recipe",
      runId,
      recipe: steps,
      approvalsRequired,
      model: effectiveModel(found.model) ?? undefined,
      webhook: trigger === "webhook" || trigger === "email" || trigger === "handoff" || trigger === "watch",
      context: context || undefined,
    }, { source: "run", runId });
    log("run_started", { runId, recipeId, trigger, delivery: delivery.status });
    startRunProgress(recipe.agentId, runId, recipe.recipe.title, steps.steps.map((step) => step.text)).catch((error) => log("slack_progress_error", { error: String(error) }));
    await db
      .update(schema.agents)
      .set({ state: "working", stateNote: recipe.recipe.title, updatedAt: new Date() })
      .where(eq(schema.agents.id, recipe.agentId));
    this.hub.broadcast(recipe.agentId, { type: "state", state: "working", note: recipe.recipe.title });
    return { ok: true as const, runId };
  }

  async finish(agentId: string, runId: string, ok: boolean, summary: string, usage?: Usage) {
    const db = getDb();
    const [run] = await db
      .update(schema.runs)
      .set({
        status: ok ? "ok" : "failed",
        summary,
        finishedAt: new Date(),
        ...(usage ? { usage: { inputTokens: Number(usage.inputTokens) || 0, outputTokens: Number(usage.outputTokens) || 0, costUsd: usage.costUsd } } : {}),
      })
      .where(and(eq(schema.runs.id, runId), eq(schema.runs.agentId, agentId)))
      .returning();
    if (!run) return;
    if (run.recipeId && ok && run.trigger !== "test") {
      await db
        .update(schema.recipes)
        .set({ runsDone: sql`${schema.recipes.runsDone} + 1` })
        .where(eq(schema.recipes.id, run.recipeId));
    }
    await db
      .update(schema.approvals)
      .set({ status: "expired", answeredAt: new Date() })
      .where(and(eq(schema.approvals.runId, runId), eq(schema.approvals.agentId, agentId), eq(schema.approvals.status, "pending")));
    const state = ok ? "done" : "stuck";
    await db.update(schema.agents).set({ state, stateNote: summary, updatedAt: new Date() }).where(eq(schema.agents.id, agentId));
    this.hub.broadcast(agentId, { type: "run_finished", runId, ok, summary });
    this.hub.broadcast(agentId, { type: "state", state, note: summary });
    await this.hub.addMessage(agentId, "system", ok ? copy.runs.finishedOk(summary) : copy.runs.finishedFail(summary), runId);
    if (!ok) this.pushStuck(agentId, runId, summary).catch((error) => log("push_error", { error: String(error) }));
    if (run.recipeId) {
      const [recipe] = await db.select({ recipe: schema.recipes.recipe }).from(schema.recipes).where(eq(schema.recipes.id, run.recipeId));
      if (recipe) {
        await finishRunProgress(agentId, runId, recipe.recipe.title, recipe.recipe.steps.map((step) => step.text), ok, summary).catch((error) => log("slack_progress_error", { error: String(error) }));
      }
    }
  }

  private async pushStuck(agentId: string, runId: string, summary: string) {
    const [agent] = await getDb().select({ ownerId: schema.agents.ownerId, name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.id, agentId));
    if (!agent) return;
    await sendPush([agent.ownerId], { title: copy.push.stuckTitle(agent.name), body: summary.slice(0, 180), url: `/runs/${runId}`, tag: `run-${runId}` });
  }

  async saveRecord(agentId: string, runId: string, steps: RunStep[], unusual: string[]) {
    const db = getDb();
    const [run] = await db
      .select({ id: schema.runs.id })
      .from(schema.runs)
      .where(and(eq(schema.runs.id, runId), eq(schema.runs.agentId, agentId)));
    if (!run) return;
    const claimed = [...new Set(steps.map((step) => step.approvalId).filter((id): id is string => Boolean(id)))].slice(0, 500);
    const owned = claimed.length
      ? new Set(
          (
            await db
              .select({ id: schema.approvals.id })
              .from(schema.approvals)
              .where(and(eq(schema.approvals.agentId, agentId), inArray(schema.approvals.id, claimed)))
          ).map((row) => row.id),
        )
      : new Set<string>();
    let shots = 0;
    const clean = steps.slice(0, 500).map((step) => {
      const keep = step.screenshotJpegBase64 && shots < RUN_RECORD_MAX_SCREENSHOTS;
      if (keep) shots += 1;
      return {
        at: Number(step.at) || Date.now(),
        text: String(step.text ?? "").slice(0, 2000),
        approvalId: step.approvalId && owned.has(step.approvalId) ? step.approvalId : undefined,
        screenshotJpegBase64: keep ? step.screenshotJpegBase64 : undefined,
      };
    });
    const notes = unusual.slice(0, 50).map((u) => String(u).slice(0, 1000));
    await db
      .insert(schema.runRecords)
      .values({ runId, steps: clean, unusual: notes })
      .onConflictDoUpdate({ target: schema.runRecords.runId, set: { steps: clean, unusual: notes } });
  }
}
