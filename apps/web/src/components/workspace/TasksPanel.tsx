import { ChevronRight, ListChecks, Plus } from "lucide-react";
import Link from "next/link";
import { messages } from "@/lib/messages";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Look } from "@/lib/look";

export type TaskSummary = { id: string; title: string; active: boolean };
export type RunSummary = { id: string; when: string; label: string; status: string; waiting: boolean };

const RUN_PILL: Record<string, string> = { ok: "g", failed: "c", running: "s" };

export function TasksPanel({
  agentId,
  owner,
  recipes,
  runs,
  look,
}: {
  agentId: string;
  owner: boolean;
  recipes: TaskSummary[];
  runs: RunSummary[];
  look?: Look;
}) {
  const t = messages.workspace;
  return (
    <div className="ws-panel">
      <p className="ws-lead">{t.tasksLead}</p>
      <section className="card p-[18px] flex flex-col gap-1">
        <div className="flex items-center gap-2 pb-2">
          <h3 className="m-0 text-[14px] font-semibold flex-1">{t.tasksTitle}</h3>
          {owner && recipes.length > 0 && (
            <Link href={`/agents/${agentId}/teach`} className="btn sec sm inline-flex items-center gap-1.5">
              <Plus size={14} aria-hidden />
              {messages.live.teach}
            </Link>
          )}
        </div>
        {recipes.length === 0 ? (
          <EmptyState size="sm" look={look} mood="curious" title={messages.empty.taskTabTitle} body={messages.empty.taskTabBody} action={owner ? { href: `/agents/${agentId}/teach`, label: messages.empty.tasksAction } : undefined} />
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col">
            {recipes.map((r) => (
              <li key={r.id} className="border-t border-graphite first:border-0">
                <Link href={`/agents/${agentId}/recipes/${r.id}`} className="ws-row">
                  <ListChecks size={16} className="flex-none text-ash" aria-hidden />
                  <span className="flex-1 min-w-0 truncate">{r.title}</span>
                  <span className={`pill ${r.active ? "g" : ""}`}>{r.active ? messages.recipe.active : messages.recipe.paused}</span>
                  <ChevronRight size={15} className="flex-none text-smoke" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card p-[18px] flex flex-col gap-1">
        <div className="flex items-center gap-2 pb-2">
          <h3 className="m-0 text-[14px] font-semibold flex-1">{messages.live.history}</h3>
          {runs.length > 0 && (
            <Link href={`/runs?agent=${agentId}`} className="text-[12.5px] text-ash underline hover:text-mist">
              {messages.live.allRuns}
            </Link>
          )}
        </div>
        {runs.length === 0 ? (
          <EmptyState size="sm" look={look} mood="sleepy" title={messages.empty.runsTitle} body={messages.empty.runsBody} />
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col">
            {runs.map((run) => (
              <li key={run.id} className="border-t border-graphite first:border-0">
                <Link href={`/runs/${run.id}`} className="ws-row flex-wrap gap-y-1.5">
                  <span className="text-smoke text-[12px] whitespace-nowrap w-[128px] flex-none truncate @max-[520px]:w-[64px]" title={run.when} suppressHydrationWarning>
                    {run.when}
                  </span>
                  <span className="flex-1 min-w-[150px] truncate">{run.label}</span>
                  {run.waiting && <span className="pill c">{t.waitingYou}</span>}
                  <span className={`pill ${RUN_PILL[run.status] ?? ""}`}>{messages.recipe.runStatus[run.status] ?? run.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
