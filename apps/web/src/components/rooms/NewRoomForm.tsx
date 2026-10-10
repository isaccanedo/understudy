"use client";

import { Check, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { openRoom } from "@/app/actions/rooms";
import { AgentFigure } from "@/components/AgentFigure";
import { Field, FieldGroup, Input } from "@/components/ui/controls";
import type { Look } from "@/lib/look";
import { messages } from "@/lib/messages";
import { ROOM_LIMITS } from "@/lib/rooms";

type Pickable = { id: string; name: string; role: string; look: Look };

export function NewRoomForm({ agents, startOpen, initialPicked = [] }: { agents: Pickable[]; startOpen: boolean; initialPicked?: string[] }) {
  const t = messages.rooms;
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>(initialPicked);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" className="btn pri self-start" onClick={() => setOpen(true)}>
        <Plus size={15} aria-hidden />
        {t.newRoom}
      </button>
    );
  }

  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= ROOM_LIMITS.maxParticipants ? list : [...list, id]));
  const ready = name.trim().length > 0 && picked.length >= ROOM_LIMITS.minParticipants;

  return (
    <form
      className="card p-[18px] flex flex-col gap-4"
      aria-label={t.newRoom}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await openRoom({ name, agentIds: picked });
          if (result.ok) router.push(`/rooms/${result.id}`);
          else setError(result.error);
        });
      }}
    >
      <h2 className="m-0 text-[15px] font-semibold tracking-[-0.015em]">{t.newRoom}</h2>
      <Field label={t.nameLabel}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} maxLength={ROOM_LIMITS.nameMax} required />
      </Field>
      <FieldGroup label={t.whoLabel} hint={t.whoHint(ROOM_LIMITS.minParticipants, ROOM_LIMITS.maxParticipants)}>
        <div className="rm-picks">
          {agents.map((agent) => {
            const on = picked.includes(agent.id);
            return (
              <button key={agent.id} type="button" className={`rm-pick ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => toggle(agent.id)}>
                <span className="rm-pick-check" aria-hidden>
                  {on && <Check size={12} strokeWidth={3} />}
                </span>
                <AgentFigure size={46} look={agent.look} live={false} />
                <span className="rm-pick-name">{agent.name}</span>
                {agent.role && <span className="rm-pick-role">{agent.role}</span>}
              </button>
            );
          })}
        </div>
      </FieldGroup>
      {error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}
      <div className="flex gap-2 justify-end">
        {!startOpen && (
          <button type="button" className="btn sec" onClick={() => setOpen(false)}>
            {messages.common.cancel}
          </button>
        )}
        <button type="submit" className="btn pri" disabled={!ready || pending}>
          {pending ? t.creating : t.create}
        </button>
      </div>
    </form>
  );
}
