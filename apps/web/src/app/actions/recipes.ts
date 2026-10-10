"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import type { Recipe } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import { messages } from "@/lib/messages";
import { webhookUrl } from "@/lib/webhook";
import { findViolation, normalizeRecipe } from "@understudy/protocol";
import { hashToken } from "@/lib/ids";
import { cleanSenderList, inboundLocalPart } from "@/lib/inbound-address";
import { getHub } from "@/server/hub-access";
import { isValidCron } from "@/server/scheduler";
import { WATCH_INTERVALS } from "@/lib/watch";
import { ownRecipe } from "./shared";

export type RecipeSettings = {
  recipe: Recipe;
  cron: string;
  timezone: string;
  askAlways: boolean;
};

export async function saveRecipe(recipeId: string, settings: RecipeSettings) {
  const { agent } = await ownRecipe(recipeId);
  const cron = settings.cron.trim();
  const timezone = settings.timezone.trim() || process.env.UNDERSTUDY_TIMEZONE || "UTC";
  if (cron && !isValidCron(cron, timezone)) return { ok: false, error: messages.recipe.cronInvalid };
  await getDb()
    .update(schema.recipes)
    .set({
      recipe: normalizeRecipe(settings.recipe),
      cron: cron || null,
      timezone,
      askAlways: settings.askAlways,
      updatedAt: new Date(),
    })
    .where(eq(schema.recipes.id, recipeId));
  revalidatePath(`/agents/${agent.id}`, "layout");
  return { ok: true };
}

export async function setRecipeActive(recipeId: string, active: boolean) {
  const { agent } = await ownRecipe(recipeId);
  await getDb().update(schema.recipes).set({ active, updatedAt: new Date() }).where(eq(schema.recipes.id, recipeId));
  revalidatePath(`/agents/${agent.id}`, "layout");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function testRecipe(recipeId: string) {
  await ownRecipe(recipeId);
  const hub = getHub();
  if (!hub) return { ok: false, reason: "offline" };
  const result = await hub.startRun(recipeId, "test");
  return { ok: result.ok, reason: result.ok ? undefined : result.reason };
}

export async function deleteRecipe(recipeId: string) {
  const { agent } = await ownRecipe(recipeId);
  await getDb().delete(schema.recipes).where(eq(schema.recipes.id, recipeId));
  return { redirectTo: `/agents/${agent.id}` };
}

export async function runRecipeNow(recipeId: string, input: string) {
  await ownRecipe(recipeId);
  const hub = getHub();
  if (!hub) return { ok: false, reason: "offline" };
  const result = await hub.startRun(recipeId, "manual", { input: input.trim().slice(0, 20000) || undefined });
  return { ok: result.ok, reason: result.ok ? undefined : result.reason };
}

export async function setRecipeWebhook(recipeId: string, enabled: boolean) {
  const { agent } = await ownRecipe(recipeId);
  const secret = enabled ? randomBytes(24).toString("base64url") : null;
  await getDb()
    .update(schema.recipes)
    .set({ webhookSecret: null, webhookSecretHash: secret ? hashToken(secret) : null, updatedAt: new Date() })
    .where(eq(schema.recipes.id, recipeId));
  revalidatePath(`/agents/${agent.id}`, "layout");
  return { url: secret ? webhookUrl(recipeId, secret) : null };
}

export async function setRecipeEmail(recipeId: string, enabled: boolean) {
  const { agent, recipe } = await ownRecipe(recipeId);
  const db = getDb();
  if (!enabled) {
    await db.delete(schema.recipeInbound).where(eq(schema.recipeInbound.recipeId, recipeId));
    revalidatePath(`/agents/${agent.id}`, "layout");
    return { localPart: null };
  }
  const localPart = inboundLocalPart(recipe.recipe.title);
  await db
    .insert(schema.recipeInbound)
    .values({ recipeId, localPart })
    .onConflictDoUpdate({ target: schema.recipeInbound.recipeId, set: { localPart } });
  revalidatePath(`/agents/${agent.id}`, "layout");
  return { localPart };
}

export async function setRecipeEmailSenders(recipeId: string, senders: string) {
  const { agent } = await ownRecipe(recipeId);
  const allowed = cleanSenderList(String(senders ?? ""));
  await getDb()
    .update(schema.recipeInbound)
    .set({ allowedSenders: allowed || null })
    .where(eq(schema.recipeInbound.recipeId, recipeId));
  revalidatePath(`/agents/${agent.id}`, "layout");
  return { allowed };
}

export async function setRecipeWatch(recipeId: string, input: { url: string; part?: string; everyMinutes: number } | null) {
  const { agent } = await ownRecipe(recipeId);
  const db = getDb();
  if (!input) {
    await db.delete(schema.recipeWatches).where(eq(schema.recipeWatches.recipeId, recipeId));
    revalidatePath(`/agents/${agent.id}`, "layout");
    return { ok: true as const, watch: null };
  }
  let url: string;
  try {
    const parsed = new URL(String(input.url ?? "").trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false as const, reason: "invalid" as const };
    url = parsed.toString().slice(0, 2000);
  } catch {
    return { ok: false as const, reason: "invalid" as const };
  }
  if (findViolation(agent.rules ?? [], { urls: [url] })) return { ok: false as const, reason: "blocked" as const };
  const part = String(input.part ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
  const everyMinutes = WATCH_INTERVALS.includes(Number(input.everyMinutes)) ? Number(input.everyMinutes) : 15;
  const [current] = await db.select().from(schema.recipeWatches).where(eq(schema.recipeWatches.recipeId, recipeId));
  const changedTarget = !current || current.url !== url || current.part !== part;
  const values = { url, part, everyMinutes, checkedAt: null, ...(changedTarget ? { lastHash: null, lastText: null, lastError: null, changedAt: null } : {}) };
  await db
    .insert(schema.recipeWatches)
    .values({ recipeId, agentId: agent.id, ...values })
    .onConflictDoUpdate({ target: schema.recipeWatches.recipeId, set: values });
  revalidatePath(`/agents/${agent.id}`, "layout");
  return { ok: true as const, watch: { url, part, everyMinutes } };
}
