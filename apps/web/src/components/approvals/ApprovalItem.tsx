"use client";

import type { Look } from "@/lib/look";
import { Check, MonitorPlay, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { answerApproval } from "@/app/actions/approvals";
import { AgentFigure } from "@/components/AgentFigure";
import { ApprovalFields } from "@/components/approvals/ApprovalFields";
import { messages } from "@/lib/messages";
import { answeredOutcome } from "@/lib/approval-outcome";
import { Input } from "@/components/ui/controls";

const t = messages.approvals;

export function ApprovalItem({
  approval,
  agent,
  when,
}: {
  approval: { id: string; summary: string; fields: { label: string; value: string }[] };
  agent: { id: string; name: string; look: Look };
  when: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  function answer(approved: boolean) {
    start(async () => {
      const result = await answerApproval(approval.id, approved, note);
      setDone(answeredOutcome(result, approved));
      router.refresh();
    });
  }

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <AgentFigure state={done ? "done" : "waiting_you"} size={40} look={agent.look} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-smoke">
            {t.from(agent.name)} · {when}
          </div>
          <div className="text-[14.5px]">{approval.summary}</div>
        </div>
        <Link href={`/agents/${agent.id}`} className="btn sec sm inline-flex items-center gap-1.5 flex-none" aria-label={t.openAgent}>
          <MonitorPlay size={15} aria-hidden />
          <span className="max-[480px]:hidden">{t.openAgent}</span>
        </Link>
      </div>
      <ApprovalFields fields={approval.fields} />
      {done ? (
        <div className="flex flex-col gap-1.5">
          <span className={`pill self-start ${done === "approved" ? "g" : done === "denied" ? "c" : ""}`}>{t.status[done] ?? done}</span>
          {done === "cancelled" && <span className="text-[12.5px] text-ash">{t.notWaiting}</span>}
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap items-center">
          <button className="btn ok inline-flex items-center gap-1.5" disabled={pending} onClick={() => answer(true)}>
            <Check size={15} aria-hidden />
            {t.approve}
          </button>
          <button className="btn sec inline-flex items-center gap-1.5" disabled={pending} onClick={() => answer(false)}>
            <X size={15} aria-hidden />
            {t.deny}
          </button>
          <Input
            size="sm"
            aria-label={t.notePlaceholder}
            className="flex-1 min-w-[180px]"
            placeholder={t.notePlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
