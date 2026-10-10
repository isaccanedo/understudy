import { CircleCheck, CircleSlash, CircleX, LoaderCircle, Square } from "lucide-react";
import { useEffect, useState } from "react";
import type { JobInfo } from "@understudy/protocol";
import type { AgentLink } from "@/components/live/useAgentSocket";
import { currentLocale, messages } from "@/lib/messages";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Look } from "@/lib/look";

const t = messages.jobs;

const ICON = { running: LoaderCircle, done: CircleCheck, failed: CircleX, stopped: CircleSlash } as const;
const TONE = { running: "text-sky animate-spin", done: "text-green", failed: "text-coral", stopped: "text-smoke" } as const;

function when(ms: number) {
  return new Date(ms).toLocaleString(currentLocale(), { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export function JobsList({ agentName, link, jobs, look }: { agentName: string; link: Pick<AgentLink, "live" | "send">; jobs: JobInfo[] | null; look?: Look }) {
  const { live, send } = link;
  const [stopping, setStopping] = useState<Set<string>>(new Set());

  useEffect(() => {
    setStopping((current) => {
      const next = new Set([...current].filter((id) => jobs?.some((job) => job.id === id && job.status === "running")));
      return next.size === current.size ? current : next;
    });
  }, [jobs]);

  return (
    <div className="ws-panel">
      <p className="ws-lead">{t.subtitle(agentName)}</p>
      <div className="card p-[18px] flex flex-col max-w-[900px]">
        {jobs === null ? (
          live.online ? (
            <div className="text-smoke text-[13px]">{t.loading}</div>
          ) : (
            <EmptyState size="sm" look={look} mood="sleepy" title={messages.empty.offlineTitle} body={t.offline} />
          )
        ) : jobs.length === 0 ? (
          <EmptyState size="sm" look={look} mood="calm" title={messages.empty.jobsTitle} body={messages.empty.jobsBody} />
        ) : (
          jobs.map((job) => {
            const Icon = ICON[job.status];
            return (
              <div key={job.id} className="flex items-center gap-3 border-t border-graphite py-3 first:border-0 first:pt-0 text-[13px]">
                <Icon size={18} strokeWidth={1.8} className={`flex-none ${TONE[job.status]}`} aria-hidden />
                <div className="min-w-0 flex-1" title={job.command}>
                  <div className="truncate font-medium">{job.name}</div>
                  <div className="text-smoke text-[12px] truncate" suppressHydrationWarning>
                    {t.status[job.status]} · {t.started(when(job.startedAt))}
                    {job.finishedAt ? ` · ${t.finished(when(job.finishedAt))}` : ""}
                    {typeof job.exitCode === "number" && job.status !== "running" ? ` · ${t.exit(job.exitCode)}` : ""}
                  </div>
                  <div className="font-mono text-[11.5px] text-smoke truncate">{job.command}</div>
                </div>
                {job.status === "running" && (
                  <button
                    type="button"
                    className="btn sec sm inline-flex items-center gap-1.5"
                    disabled={!live.online || stopping.has(job.id)}
                    onClick={() => {
                      if (send({ type: "job_stop", jobId: job.id })) setStopping((current) => new Set(current).add(job.id));
                    }}
                  >
                    <Square size={12} aria-hidden />
                    {stopping.has(job.id) ? t.stopping : t.stop}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
