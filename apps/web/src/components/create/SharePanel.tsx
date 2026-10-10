"use client";

import { useActionState, useState, useTransition } from "react";
import { addAgentMember, removeAgentMember } from "@/app/actions/agents";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";
import { Select } from "@/components/ui/Select";

export function SharePanel({
  agentId,
  members,
}: {
  agentId: string;
  members: { userId: string; name: string; email: string; role: string }[];
}) {
  const t = messages.share;
  const [state, action, pending] = useActionState(addAgentMember.bind(null, agentId), null);
  const [removing, start] = useTransition();
  const [inviting, setInviting] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {members.length === 0 ? (
        <p className="m-0 text-smoke text-[12.5px]">{t.empty}</p>
      ) : (
        <ul className="st-list">
          {members.map((m) => (
            <li key={m.userId}>
              <div className="min-w-0 flex-1">
                <div className="truncate">{m.name}</div>
                <div className="text-smoke text-[12px] truncate">{m.email}</div>
              </div>
              <span className="pill">{t.roles[m.role]}</span>
              <button className="btn sec sm" disabled={removing} onClick={() => start(() => removeAgentMember(agentId, m.userId))}>
                {t.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
      {inviting ? (
        <form action={action} className="flex flex-col gap-2.5">
          <div className="flex gap-2 flex-wrap">
            <Input name="email" type="email" className="flex-1 min-w-[200px]" placeholder={t.email} aria-label={t.email} required autoFocus />
            <Select
              name="role"
              className="!w-[150px] flex-none"
              aria-label={t.role}
              defaultValue="approver"
              options={[
                { value: "approver", label: t.roles.approver, description: t.roleHints.approver },
                { value: "viewer", label: t.roles.viewer, description: t.roleHints.viewer },
              ]}
            />
          </div>
          <p className="m-0 fld-hint">{t.hint}</p>
          <div className="flex gap-2">
            <button type="submit" className="btn pri sm" disabled={pending}>
              {t.add}
            </button>
            <button type="button" className="btn sec sm" onClick={() => setInviting(false)}>
              {messages.common.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn sec sm self-start" onClick={() => setInviting(true)}>
          {t.invite}
        </button>
      )}
      {state?.message && <div className={`text-[12.5px] ${state.ok ? "text-green" : "text-coral"}`}>{state.message}</div>}
    </div>
  );
}
