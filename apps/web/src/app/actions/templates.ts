"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/ids";
import { messages } from "@/lib/messages";
import { requireUser } from "@/lib/session";
import { fillPlaceholders, recipeForTemplate } from "@/lib/templates";
import { ownAgent, ownRecipe } from "./shared";

export async function exportTemplate(recipeId: string, input: { title: string; description: string; includeSchedule: boolean }) {
  const { user, recipe } = await ownRecipe(recipeId);
  const title = input.title.trim().slice(0, 120) || recipe.recipe.title;
  const id = newId("tpl");
  await getDb()
    .insert(schema.templates)
    .values({
      id,
      title,
      description: input.description.trim().slice(0, 600),
      recipe: recipeForTemplate({ ...recipe.recipe, title }),
      cron: input.includeSchedule ? recipe.cron : null,
      createdBy: user.id,
    });
  console.log(JSON.stringify({ event: "template_exported", templateId: id, recipeId, by: user.id }));
  revalidatePath("/templates");
  return { ok: true, id };
}

export async function installTemplate(templateId: string, agentId: string, values: Record<string, string>) {
  const { agent } = await ownAgent(agentId);
  const db = getDb();
  const [template] = await db.select().from(schema.templates).where(eq(schema.templates.id, templateId));
  if (!template) return { ok: false, error: messages.common.notFound };
  const safeValues = Object.fromEntries(Object.entries(values ?? {}).slice(0, 30).map(([key, value]) => [String(key).slice(0, 60), String(value ?? "")]));
  const recipe = fillPlaceholders(template.recipe, safeValues);
  const id = newId("rcp");
  await db.insert(schema.recipes).values({
    id,
    agentId: agent.id,
    recipe,
    cron: template.cron,
    timezone: process.env.UNDERSTUDY_TIMEZONE?.trim() || "UTC",
    active: false,
  });
  await db
    .update(schema.templates)
    .set({ uses: sql`${schema.templates.uses} + 1` })
    .where(eq(schema.templates.id, templateId));
  console.log(JSON.stringify({ event: "template_installed", templateId, recipeId: id, agentId: agent.id }));
  revalidatePath("/recipes");
  return { ok: true, redirectTo: `/agents/${agent.id}/recipes/${id}` };
}

export async function deleteTemplate(templateId: string) {
  const user = await requireUser();
  const db = getDb();
  const [template] = await db.select({ createdBy: schema.templates.createdBy }).from(schema.templates).where(eq(schema.templates.id, templateId));
  if (!template || (template.createdBy !== user.id && !user.admin)) return { ok: false };
  await db.delete(schema.templates).where(eq(schema.templates.id, templateId));
  revalidatePath("/templates");
  return { ok: true };
}
