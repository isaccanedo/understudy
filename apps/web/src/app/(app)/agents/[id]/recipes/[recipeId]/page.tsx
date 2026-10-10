import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { RecipeEditor } from "@/components/recipe/RecipeEditor";
import { getDb, schema } from "@/lib/db";
import { formatWhen } from "@/lib/format";
import { requireOwnAgent } from "@/lib/session";
import { inboundConfig } from "@/server/inbound-email/config";

export default async function RecipePage({ params }: { params: Promise<{ id: string; recipeId: string }> }) {
  const { id, recipeId } = await params;
  const { agent } = await requireOwnAgent(id);
  const db = getDb();
  const [recipe] = await db
    .select()
    .from(schema.recipes)
    .where(and(eq(schema.recipes.id, recipeId), eq(schema.recipes.agentId, id)));
  if (!recipe) redirect(`/agents/${id}`);
  const runs = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.recipeId, recipeId))
    .orderBy(desc(schema.runs.startedAt))
    .limit(10);
  const [watch] = await db.select().from(schema.recipeWatches).where(eq(schema.recipeWatches.recipeId, recipeId));
  const domain = inboundConfig().domain;
  const [inbound] = domain ? await db.select().from(schema.recipeInbound).where(eq(schema.recipeInbound.recipeId, recipeId)) : [];
  const [owner] = domain ? await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, agent.ownerId)) : [];
  return (
    <RecipeEditor
      recipeId={recipe.id}
      agentId={agent.id}
      agentName={agent.name}
      look={agent.look}
      initial={recipe.recipe}
      initialCron={recipe.cron ?? ""}
      initialTimezone={recipe.timezone}
      initialAskAlways={recipe.askAlways}
      initialActive={recipe.active}
      runsDone={recipe.runsDone}
      webhookEnabled={Boolean(recipe.webhookSecretHash)}
      watch={watch ? { url: watch.url, part: watch.part, everyMinutes: watch.everyMinutes, lastError: watch.lastError, lastChange: watch.changedAt ? formatWhen(watch.changedAt) : null, lastChecked: watch.lastHash && watch.checkedAt ? formatWhen(watch.checkedAt) : null } : null}
      email={domain ? { domain, localPart: inbound?.localPart ?? null, senders: inbound?.allowedSenders ?? "", ownerDomain: owner?.email.split("@").pop() ?? "" } : null}
      runs={runs.map((r) => ({ id: r.id, trigger: r.trigger, status: r.status, summary: r.summary, when: formatWhen(r.startedAt) }))}
    />
  );
}
