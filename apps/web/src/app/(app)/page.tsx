import type { CSSProperties } from "react";
import Link from "next/link";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { AgentFigure } from "@/components/AgentFigure";
import { accessibleAgentIds } from "@/lib/access";
import { getDb, schema } from "@/lib/db";
import { formatWhen } from "@/lib/format";
import { cleanLook } from "@/lib/look";
import { messages } from "@/lib/messages";
import { requireUser } from "@/lib/session";
import { STATE_PILL } from "@/lib/state-pill";
import { nextRunAt } from "@/server/scheduler";
import { EmptyState } from "@/components/ui/EmptyState";

const t = messages.home;

export default async function HomePage() {
  const user = await requireUser();
  const db = getDb();
  const [visible, answerable] = await Promise.all([accessibleAgentIds(user.id), accessibleAgentIds(user.id, ["owner", "approver"])]);
  const agents = visible.length
    ? await db.select().from(schema.agents).where(inArray(schema.agents.id, visible)).orderBy(desc(schema.agents.createdAt))
    : [];
  const ids = agents.map((b) => b.id);
  const pending = answerable.length
    ? await db
        .select()
        .from(schema.approvals)
        .where(and(inArray(schema.approvals.agentId, answerable), eq(schema.approvals.status, "pending")))
        .orderBy(desc(schema.approvals.createdAt))
    : [];
  const recipes = ids.length
    ? await db.select().from(schema.recipes).where(and(inArray(schema.recipes.agentId, ids), eq(schema.recipes.active, true)))
    : [];

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthRuns = ids.length
    ? await db
        .select({ agentId: schema.runs.agentId, usage: schema.runs.usage })
        .from(schema.runs)
        .where(and(inArray(schema.runs.agentId, ids), gte(schema.runs.startedAt, monthStart)))
    : [];
  const costBy = new Map<string, number>();
  for (const r of monthRuns) if (typeof r.usage?.costUsd === "number") costBy.set(r.agentId, (costBy.get(r.agentId) ?? 0) + r.usage.costUsd);

  const pendingBy = new Map<string, number>();
  for (const p of pending) pendingBy.set(p.agentId, (pendingBy.get(p.agentId) ?? 0) + 1);

  function schedule(agentId: string) {
    const next = recipes
      .filter((r) => r.agentId === agentId && r.cron)
      .map((r) => nextRunAt(r.cron as string, r.timezone))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return next ? t.nextRun(formatWhen(next)) : t.noSchedule;
  }

  const first = pending[0];
  const firstAgent = first ? agents.find((b) => b.id === first.agentId) : null;

  return (
    <div className="page wide">
      <div className="top">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        {agents.length > 0 && (
          <Link href="/agents/new" className="btn pri">
            {t.newAgent}
          </Link>
        )}
      </div>

      {pending.length > 0 && (
        <div className="card mt-5 flex items-center gap-3.5 px-[18px] py-3 text-[#ffd6d6]">
          <AgentFigure state="waiting_you" size={34} count={pending.length} look={firstAgent?.look} />
          <div className="min-w-0">
            <b className="text-white">{t.waitingStrip(pending.length)}</b>
            {firstAgent && first && (
              <span>
                {" · "}
                {firstAgent.name}: {first.summary}
              </span>
            )}
          </div>
          <Link href="/waiting" className="btn sec ml-auto">
            {t.seeNow}
          </Link>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="py-6">
          <EmptyState framed mood="happy" title={messages.empty.agentsTitle} body={messages.empty.agentsBody} action={{ href: "/agents/new", label: messages.empty.agentsAction }} />
        </div>
      ) : (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 py-6">
        {agents.map((b) => {
          const count = pendingBy.get(b.id) ?? 0;
          const state = count > 0 ? "waiting_you" : b.state;
          const pill = STATE_PILL[state];
          const note = count > 0 ? pending.find((p) => p.agentId === b.id)?.summary : b.stateNote;
          const computer = b.computerStatus !== "running" ? t.computer[b.computerStatus] : null;
          return (
            <Link key={b.id} href={`/agents/${b.id}`} className="card p-3 flex flex-col gap-3 no-underline">
              <div className="figure-stage h-[150px]" style={{ "--tint": cleanLook(b.look).color } as CSSProperties}>
                <AgentFigure state={state} size={108} look={b.look} count={count} />
                {b.ownerId !== user.id && <span className="pill absolute top-2.5 left-2.5">{t.shared}</span>}
                <span className={`pill ${pill} absolute top-2.5 right-2.5`}>
                  <span className="dot" />
                  {messages.states[state]}
                </span>
              </div>
              <div className="px-2 flex flex-col gap-1 min-w-0">
                <h3 className="m-0 text-[16px] font-semibold tracking-[-0.02em] truncate">{b.name}</h3>
                <div className="text-smoke text-[12.5px] truncate">{b.role}</div>
              </div>
              <div className="mx-2 text-[12.5px] text-ash min-h-[38px] line-clamp-2">
                <b className="text-mist font-medium">{messages.stateLead[state]}</b> {note ?? computer ?? ""}
              </div>
              <div className="mx-2 mb-1 pt-2.5 border-t border-line flex justify-between items-center text-[11.5px] text-smoke gap-2">
                <span className="truncate">{schedule(b.id)}</span>
                {costBy.get(b.id) ? <span className="truncate text-right">{messages.run.monthUsage(messages.run.cost(costBy.get(b.id) as number))}</span> : null}
              </div>
            </Link>
          );
        })}
        <Link
          href="/agents/new"
          className="card grid place-items-center text-center text-ash gap-2.5 p-6 no-underline min-h-[300px]"
        >
          <div className="w-11 h-11 rounded-full bg-graphite grid place-items-center text-[22px] text-mist">+</div>
          <div>
            {t.teachNew}
            <br />
            <span className="muted text-[12px]">{t.teachNewHint}</span>
          </div>
        </Link>
      </div>
      )}
    </div>
  );
}
