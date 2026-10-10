import Link from "next/link";
import { messages } from "@/lib/messages";

const t = messages.recipe;

export type RecentRun = { id: string; trigger: string; status: string; summary: string | null; when: string };

export function RecentRuns({ agentId, runs }: { agentId: string; runs: RecentRun[] }) {
  return (
    <div className="card rp-card">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-[14px] font-semibold">{t.runs}</h3>
        <Link href={`/runs?agent=${agentId}`} className="text-[12px] text-ash underline hover:text-mist">
          {t.allRuns}
        </Link>
      </div>
      {runs.length === 0 && <div className="text-smoke text-[12.5px]">{t.noRuns}</div>}
      <div className="flex flex-col gap-2">
        {runs.map((run) => (
          <Link key={run.id} href={`/runs/${run.id}`} className="flex justify-between gap-3 text-[12.5px] no-underline hover:text-mist">
            <span className="min-w-0">
              <span className="text-ash">{run.when}</span> · {t.runTrigger[run.trigger]}
              {run.summary && <div className="text-smoke truncate">{run.summary}</div>}
            </span>
            <span className={`pill ${run.status === "ok" ? "g" : run.status === "failed" ? "c" : "s"}`}>{t.runStatus[run.status]}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
