import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { AgentFigure } from "@/components/AgentFigure";
import { AutoRefresh } from "@/components/AutoRefresh";
import { agentAccess } from "@/lib/access";
import { getDb, schema } from "@/lib/db";
import { formatWhen } from "@/lib/format";
import { messages } from "@/lib/messages";
import { requireUser } from "@/lib/session";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUSES = ["ok", "failed", "running"] as const;
type StatusFilter = (typeof STATUSES)[number];

function pillFor(status: string) {
  return status === "ok" ? "g" : status === "failed" ? "c" : "s";
}

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ agent?: string; status?: string }> }) {
  const { agent: agentId, status } = await searchParams;
  const user = await requireUser();
  if (!agentId || !(await agentAccess(user.id, agentId))) redirect("/");
  const filter = STATUSES.includes(status as StatusFilter) ? (status as StatusFilter) : null;
  const db = getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
  if (!agent) redirect("/");

  const rows = await db
    .select({ run: schema.runs, recipeTitle: schema.recipes.recipe, unusual: schema.runRecords.unusual })
    .from(schema.runs)
    .leftJoin(schema.recipes, eq(schema.recipes.id, schema.runs.recipeId))
    .leftJoin(schema.runRecords, eq(schema.runRecords.runId, schema.runs.id))
    .where(filter ? and(eq(schema.runs.agentId, agentId), eq(schema.runs.status, filter)) : eq(schema.runs.agentId, agentId))
    .orderBy(desc(schema.runs.startedAt))
    .limit(100);

  const runIds = rows.map((row) => row.run.id);
  const waiting = new Set(
    runIds.length
      ? (
          await db
            .select({ runId: schema.approvals.runId })
            .from(schema.approvals)
            .where(and(inArray(schema.approvals.runId, runIds), eq(schema.approvals.status, "pending")))
        ).map((row) => row.runId)
      : [],
  );

  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent = await db
    .select({ usage: schema.runs.usage })
    .from(schema.runs)
    .where(and(eq(schema.runs.agentId, agentId), gte(schema.runs.startedAt, monthAgo)));
  const totals = recent.reduce(
    (sum, row) => ({
      count: sum.count + 1,
      input: sum.input + (row.usage?.inputTokens ?? 0),
      output: sum.output + (row.usage?.outputTokens ?? 0),
      cost: sum.cost + (row.usage?.costUsd ?? 0),
      priced: sum.priced || typeof row.usage?.costUsd === "number",
    }),
    { count: 0, input: 0, output: 0, cost: 0, priced: false },
  );

  const t = messages.runList;
  const anyRunning = rows.some((row) => row.run.status === "running");
  const filterHref = (value: string | null) => `/runs?agent=${encodeURIComponent(agentId)}${value ? `&status=${value}` : ""}`;

  return (
    <div className="page">
      {anyRunning && <AutoRefresh seconds={10} />}
      <div className="top">
        <div className="flex gap-4 items-center">
          <AgentFigure state={anyRunning ? "working" : "calm"} size={54} look={agent.look} />
          <div>
            <h1>{t.title(agent.name)}</h1>
            <p>
              {t.last30}: {t.count(totals.count)}
              {totals.input + totals.output > 0 ? ` · ${messages.run.tokens(totals.input, totals.output)}` : ""}
              {totals.priced ? ` · ${messages.run.cost(totals.cost)}` : ""}
            </p>
          </div>
        </div>
        <Link href={`/agents/${agent.id}`} className="btn sec sm">
          {messages.common.back}
        </Link>
      </div>

      <div className="flex flex-col gap-4 py-5">
        <nav className="flex gap-2 flex-wrap" aria-label={t.title(agent.name)}>
          {[null, ...STATUSES].map((value) => (
            <Link
              key={value ?? "all"}
              href={filterHref(value)}
              className={`pill ${filter === value ? "s" : ""}`}
              aria-current={filter === value ? "page" : undefined}
            >
              {t.filters[value ?? "all"]}
            </Link>
          ))}
        </nav>

        {rows.length === 0 ? (
          filter ? (
            <EmptyState framed size="sm" look={agent.look} mood="curious" title={messages.empty.runsFilteredTitle} />
          ) : (
            <EmptyState framed look={agent.look} mood="sleepy" title={messages.empty.runsTitle} body={messages.empty.runsBody} action={{ href: `/agents/${agent.id}/teach`, label: messages.empty.tasksAction }} />
          )
        ) : (
          <ul className="card m-0 p-0 list-none">
            {rows.map(({ run, recipeTitle, unusual }) => (
              <li key={run.id} className="border-t border-graphite first:border-0">
                <Link
                  href={`/runs/${run.id}`}
                  className="grid grid-cols-[150px_1fr_auto] gap-4 items-center px-[18px] py-3 no-underline hover:bg-graphite/50 max-[700px]:grid-cols-1 max-[700px]:gap-1"
                >
                  <span className="text-smoke text-[12.5px] whitespace-nowrap" suppressHydrationWarning>
                    {formatWhen(run.startedAt)} · {messages.recipe.runTrigger[run.trigger] ?? run.trigger}
                  </span>
                  <span className="min-w-0 flex flex-col gap-0.5">
                    <span className="text-[13.5px] font-medium truncate">{recipeTitle?.title ?? t.noRecipe}</span>
                    <span className="text-[12.5px] text-ash truncate">{run.summary ?? t.noSummary}</span>
                  </span>
                  <span className="flex gap-2 items-center justify-end flex-wrap max-[700px]:justify-start">
                    {waiting.has(run.id) && <span className="pill a">{t.waiting}</span>}
                    {unusual && unusual.length > 0 && <span className="pill c">{t.unusual(unusual.length)}</span>}
                    {run.usage && (
                      <span className="text-[11.5px] text-smoke whitespace-nowrap">
                        {typeof run.usage.costUsd === "number"
                          ? messages.run.cost(run.usage.costUsd)
                          : messages.run.tokens(run.usage.inputTokens, run.usage.outputTokens)}
                      </span>
                    )}
                    <span className={`pill ${pillFor(run.status)}`}>
                      <span className="dot" />
                      {messages.recipe.runStatus[run.status]}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
