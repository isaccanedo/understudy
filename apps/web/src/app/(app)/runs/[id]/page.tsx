import { CircleCheck, CircleX, LoaderCircle, ShieldAlert, ShieldCheck, ShieldX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { AgentFigure } from "@/components/AgentFigure";
import { AutoRefresh } from "@/components/AutoRefresh";
import { agentAccess } from "@/lib/access";
import { getDb, schema } from "@/lib/db";
import { formatWhen } from "@/lib/format";
import { messages } from "@/lib/messages";
import { requireUser } from "@/lib/session";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = getDb();
  const [row] = await db
    .select({ run: schema.runs, agent: schema.agents, recipe: schema.recipes })
    .from(schema.runs)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.runs.agentId))
    .leftJoin(schema.recipes, eq(schema.recipes.id, schema.runs.recipeId))
    .where(eq(schema.runs.id, id));
  if (!row || !(await agentAccess(user.id, row.agent.id))) redirect("/");
  const { run, agent, recipe } = row;
  const [record] = await db.select().from(schema.runRecords).where(eq(schema.runRecords.runId, id));
  const approvalIds = (record?.steps ?? []).map((s) => s.approvalId).filter((x): x is string => Boolean(x));
  const approvals = approvalIds.length
    ? await db.select().from(schema.approvals).where(and(eq(schema.approvals.agentId, agent.id), inArray(schema.approvals.id, approvalIds)))
    : await db.select().from(schema.approvals).where(and(eq(schema.approvals.agentId, agent.id), eq(schema.approvals.runId, id)));
  const t = messages.run;
  const title = recipe?.recipe.title ?? "";
  const statusPill = run.status === "ok" ? "g" : run.status === "failed" ? "c" : "s";

  return (
    <div className="page">
      {run.status === "running" && <AutoRefresh seconds={5} />}
      <div className="top">
        <div className="flex gap-4 items-center">
          <AgentFigure state={run.status === "running" ? "working" : run.status === "ok" ? "done" : "stuck"} size={54} look={agent.look} />
          <div>
            <h1>{t.title(title)}</h1>
            <p>
              {agent.name} · {messages.recipe.runTrigger[run.trigger]} · {t.started} {formatWhen(run.startedAt)}
              {run.finishedAt ? ` · ${t.finished} ${formatWhen(run.finishedAt)}` : ""}
            </p>
          </div>
        </div>
        <span className={`pill ${statusPill}`}>
          <span className="dot" />
          {messages.recipe.runStatus[run.status]}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-5 py-5 max-[1000px]:grid-cols-1">
        <div className="flex flex-col gap-4 min-w-0">
          {record && record.unusual.length > 0 && (
            <div className="card p-[18px] border-coral bg-ember/40">
              <h3 className="m-0 mb-2 text-[14px] font-semibold text-coral flex items-center gap-2">
                <TriangleAlert size={16} aria-hidden />
                {t.unusual}
              </h3>
              <ul className="m-0 pl-5 flex flex-col gap-1 text-[13px]">
                {record.unusual.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="card p-[18px]">
            <h3 className="m-0 mb-3 text-[14px] font-semibold">{t.steps}</h3>
            {!record || record.steps.length === 0 ? (
              <div className="text-smoke text-[13px]">{t.noSteps}</div>
            ) : (
              <ol className="m-0 p-0 list-none flex flex-col gap-3">
                {record.steps.map((step, i) => {
                  const approval = step.approvalId ? approvals.find((a) => a.id === step.approvalId) : undefined;
                  const current = run.status === "running" && i === record.steps.length - 1;
                  const StepIcon = current ? LoaderCircle : run.status === "failed" && i === record.steps.length - 1 ? CircleX : CircleCheck;
                  return (
                    <li key={i} className="grid grid-cols-[26px_1fr] gap-3 text-[13px] border-t border-graphite pt-3 first:border-0 first:pt-0">
                      <div className="w-6 h-6 grid place-items-center" aria-label={String(i + 1)}>
                        <StepIcon size={18} strokeWidth={1.8} className={current ? "text-sky animate-spin" : StepIcon === CircleX ? "text-coral" : "text-green"} aria-hidden />
                      </div>
                      <div className="min-w-0 flex flex-col gap-2">
                        <div>
                          <span className="text-smoke text-[11.5px] mr-2" suppressHydrationWarning>
                            {formatWhen(new Date(step.at))}
                          </span>
                          {step.text}
                        </div>
                        {approval && (
                          <div className="flex items-center gap-2 text-[12px]">
                            <span className={`pill inline-flex items-center gap-1 ${approval.status === "approved" ? "g" : approval.status === "pending" ? "a" : "c"}`}>
                              {approval.status === "approved" ? <ShieldCheck size={13} aria-hidden /> : approval.status === "pending" ? <ShieldAlert size={13} aria-hidden /> : <ShieldX size={13} aria-hidden />}
                              {t.approval}: {messages.approvals.status[approval.status]}
                            </span>
                            <span className="text-ash truncate">{approval.summary}</span>
                          </div>
                        )}
                        {step.screenshotJpegBase64 && (
                          <img
                            src={`data:image/jpeg;base64,${step.screenshotJpegBase64}`}
                            alt=""
                            className="rounded-lg border border-line max-w-full"
                            loading="lazy"
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {run.summary && (
            <div className="card p-[18px]">
              <h3 className="m-0 mb-2 text-[14px] font-semibold">{t.summary}</h3>
              <p className="m-0 text-[13px] text-ash whitespace-pre-wrap">{run.summary}</p>
            </div>
          )}
          {run.input && (
            <div className="card p-[18px]">
              <h3 className="m-0 mb-2 text-[14px] font-semibold">{t.input}</h3>
              <pre className="m-0 text-[12px] text-ash whitespace-pre-wrap break-words font-mono">{run.input}</pre>
            </div>
          )}
          {run.usage && (
            <div className="card p-[18px]">
              <h3 className="m-0 mb-2 text-[14px] font-semibold">{t.usage}</h3>
              <div className="text-[13px] text-ash">{t.tokens(run.usage.inputTokens, run.usage.outputTokens)}</div>
              {typeof run.usage.costUsd === "number" && <div className="text-[13px] text-mist mt-1">{t.cost(run.usage.costUsd)}</div>}
            </div>
          )}
          {approvals.length > 0 && !record && (
            <div className="card p-[18px] flex flex-col gap-2">
              <h3 className="m-0 text-[14px] font-semibold">{t.approval}</h3>
              {approvals.map((a) => (
                <div key={a.id} className="text-[12.5px] flex gap-2 items-center">
                  <span className={`pill ${a.status === "approved" ? "g" : a.status === "pending" ? "a" : "c"}`}>{messages.approvals.status[a.status]}</span>
                  <span className="truncate">{a.summary}</span>
                </div>
              ))}
            </div>
          )}
          <Link href={`/agents/${agent.id}`} className="btn sec self-start">
            {messages.common.back}
          </Link>
        </div>
      </div>
    </div>
  );
}
