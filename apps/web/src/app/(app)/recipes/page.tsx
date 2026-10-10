import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { AgentFigure } from "@/components/AgentFigure";
import { EmptyState } from "@/components/ui/EmptyState";
import { getDb, schema } from "@/lib/db";
import { formatWhen } from "@/lib/format";
import { messages } from "@/lib/messages";
import { requireUser } from "@/lib/session";
import { nextRunAt } from "@/server/scheduler";

const t = messages.recipe;

export default async function RecipesPage() {
  const user = await requireUser();
  const rows = await getDb()
    .select({ recipe: schema.recipes, agent: schema.agents })
    .from(schema.recipes)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.recipes.agentId))
    .where(eq(schema.agents.ownerId, user.id))
    .orderBy(desc(schema.recipes.updatedAt));
  const [firstAgent] = rows.length ? [] : await getDb().select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.ownerId, user.id)).limit(1);
  return (
    <div className="page narrow">
      <div className="top">
        <div>
          <h1>{t.listTitle}</h1>
          <p>{t.listSubtitle}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 py-6">
        {rows.length === 0 && (
          <EmptyState
            framed
            mood="curious"
            title={messages.empty.tasksTitle}
            body={messages.empty.tasksBody}
            action={firstAgent ? { href: `/agents/${firstAgent.id}/teach`, label: messages.empty.tasksAction } : { href: "/agents/new", label: messages.empty.agentsAction }}
          />
        )}
        {rows.map(({ recipe, agent }) => {
          const next = recipe.active && recipe.cron ? nextRunAt(recipe.cron, recipe.timezone) : null;
          return (
            <Link
              key={recipe.id}
              href={`/agents/${agent.id}/recipes/${recipe.id}`}
              className="card px-5 py-4 flex items-center gap-4 no-underline hover:border-line"
            >
              <AgentFigure size={40} look={agent.look} live={false} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{recipe.recipe.title}</div>
                <div className="text-smoke text-[12.5px] truncate">
                  {agent.name} · {t.stepsCount(recipe.recipe.steps.length)}
                  {next ? ` · ${t.nextRun(formatWhen(next))}` : ""}
                </div>
              </div>
              <span className={`pill ${recipe.active ? "g" : ""}`}>
                <span className="dot" />
                {recipe.active ? t.active : t.paused}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
