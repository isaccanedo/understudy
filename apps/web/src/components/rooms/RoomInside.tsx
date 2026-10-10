"use client";

import { ArrowLeft, MessageCircle, Square, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentState } from "@understudy/protocol";
import { removeRoom } from "@/app/actions/rooms";
import { AgentFigure } from "@/components/AgentFigure";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Composer, DayDivider, MessageRow, StreamingRow, WorkingRow } from "@/components/inside/ChatParts";
import { useSpeech } from "@/components/live/useSpeech";
import type { Look } from "@/lib/look";
import { messages } from "@/lib/messages";
import { findMentions, mentionsEveryone, mightBePass, roomRows } from "@/lib/rooms";
import type { ChatEntry, RoomEntry, RoomPresence } from "@/server/hub-types";
import { useRoomSocket } from "./useRoomSocket";

export type RoomMemberView = { id: string; name: string; role: string; look: Look; state: AgentState; online: boolean };

type Draft = { agentId: string; streamId: string; text: string };

function asChat(entry: RoomEntry): ChatEntry {
  return { id: entry.id, role: entry.author === "owner" ? "user" : entry.author === "agent" ? "agent" : "system", text: entry.text, at: entry.at };
}

function merge(list: RoomEntry[], incoming: RoomEntry[]) {
  const known = new Set(list.map((entry) => entry.id));
  const fresh = incoming.filter((entry) => !known.has(entry.id));
  if (!fresh.length) return list;
  return [...list, ...fresh].sort((a, b) => a.at.localeCompare(b.at));
}

export function RoomInside({ room, members, initial, ceiling }: { room: { id: string; name: string }; members: RoomMemberView[]; initial: RoomEntry[]; ceiling: number | null }) {
  const t = messages.rooms;
  const router = useRouter();
  const [entries, setEntries] = useState(initial);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [presence, setPresence] = useState<Record<string, RoomPresence>>(() =>
    Object.fromEntries(members.map((member) => [member.id, { agentId: member.id, working: false, note: null, online: member.online }])),
  );
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const byId = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  const { connected, error, send } = useRoomSocket(room.id, {
    onEntries: (incoming) => {
      setEntries((list) => merge(list, incoming));
      const speakers = new Set(incoming.filter((entry) => entry.author === "agent").map((entry) => entry.agentId));
      if (speakers.size) setDrafts((list) => list.filter((d) => !speakers.has(d.agentId)));
    },
    onDelta: (agentId, streamId, text) =>
      setDrafts((list) => (list.some((d) => d.streamId === streamId) ? list.map((d) => (d.streamId === streamId ? { ...d, text } : d)) : [...list, { agentId, streamId, text }])),
    onPresence: (list) => {
      setPresence((current) => ({ ...current, ...Object.fromEntries(list.map((p) => [p.agentId, p])) }));
      const idle = new Set(list.filter((p) => !p.working).map((p) => p.agentId));
      if (idle.size) setDrafts((d) => d.filter((x) => !idle.has(x.agentId)));
    },
  });

  const speech = useSpeech((text) => setDraft((d) => (d ? `${d} ${text}` : text)));

  const visibleDrafts = drafts.filter((d) => !mightBePass(d.text));
  const working = members.filter((member) => presence[member.id]?.working && !visibleDrafts.some((d) => d.agentId === member.id));

  useEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight });
  }, [entries.length, drafts, working.length]);

  const rows = useMemo(() => roomRows(entries), [entries]);
  const addressed = useMemo(() => findMentions(draft, members), [draft, members]);
  const toEveryone = addressed.length === 0 || mentionsEveryone(draft);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    if (send({ type: "chat", text })) setDraft("");
  }

  function address(member: RoomMemberView | null) {
    const strip = (text: string, names: string[]) =>
      names.reduce((value, name) => value.replace(new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s?`, "giu"), ""), text).trimStart();
    setDraft((current) => {
      if (!member) return strip(current, members.map((m) => m.name));
      if (findMentions(current, [member]).length) return strip(current, [member.name]);
      return `@${member.name} ${current}`;
    });
  }

  const busy = working.length > 0 || visibleDrafts.length > 0 || members.some((member) => presence[member.id]?.working);

  function stop() {
    if (send({ type: "stop" })) setDrafts([]);
  }

  const stateOf = (member: RoomMemberView): AgentState => (presence[member.id]?.working ? "working" : member.state === "waiting_you" ? "waiting_you" : "calm");

  return (
    <div className="rm-layout">
      <section className="cx-col rm-col" aria-label={room.name}>
        <header className="cx-head">
          <Link href="/rooms" aria-label={messages.common.back} className="cx-back">
            <ArrowLeft size={17} aria-hidden />
          </Link>
          <span className="rm-stack" aria-hidden>
            {members.slice(0, 4).map((member) => (
              <span key={member.id} className="rm-stack-item">
                <AgentFigure size={30} look={member.look} state={stateOf(member)} />
              </span>
            ))}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="cx-title">{room.name}</h1>
            <div className="cx-subtitle">
              <span className={`cx-state ${connected ? "g" : ""}`} aria-hidden />
              <span className="truncate">{members.map((member) => member.name).join(", ")}</span>
            </div>
          </div>
          <button type="button" className="rm-stop" onClick={stop} disabled={!busy || !connected} title={t.stopRoomHint}>
            <Square size={12} fill="currentColor" aria-hidden />
            {t.stop}
          </button>
        </header>
        <div
          ref={listRef}
          className="cx-list scroll-thin"
          aria-live="polite"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {entries.length === 0 && drafts.length === 0 && working.length === 0 && (
            <div className="cx-empty">
              <span className="rm-stack" aria-hidden>
                {members.slice(0, 4).map((member) => (
                  <span key={member.id} className="rm-stack-item">
                    <AgentFigure size={48} look={member.look} />
                  </span>
                ))}
              </span>
              <p>{t.emptyRoom}</p>
            </div>
          )}
          {rows.map((row) => {
            if (row.kind === "day") return <DayDivider key={row.key} at={row.at} />;
            const member = row.entry.agentId ? byId.get(row.entry.agentId) : undefined;
            return (
              <MessageRow
                key={row.key}
                entry={asChat(row.entry)}
                continued={row.continued}
                agentName={member?.name ?? t.someoneWhoLeft}
                look={member?.look ?? ({} as Look)}
              />
            );
          })}
          {visibleDrafts.map((d) => {
            const member = byId.get(d.agentId);
            return member ? <StreamingRow key={d.streamId} text={d.text} agentName={member.name} look={member.look} /> : null;
          })}
          {working.map((member) => (
            <WorkingRow key={member.id} agentName={member.name} look={member.look} note={presence[member.id]?.note ?? null} />
          ))}
        </div>
        {error && <div className="err mx-3">{error}</div>}
        <div className="rm-talkto" role="group" aria-label={t.talkTo}>
          <span className="rm-talkto-label">{t.talkTo}</span>
          <button type="button" className="rm-chip" aria-pressed={toEveryone} onClick={() => address(null)}>
            <UsersRound size={13} aria-hidden />
            {t.everyone}
          </button>
          {members.map((member) => (
            <button key={member.id} type="button" className="rm-chip" aria-pressed={!toEveryone && addressed.includes(member.id)} onClick={() => address(member)}>
              <AgentFigure size={16} look={member.look} live={false} />
              {member.name}
            </button>
          ))}
        </div>
        <Composer agentName={t.composerName(room.name)} draft={draft} setDraft={setDraft} onSubmit={submit} speech={speech} />
      </section>

      <aside className="rm-side" aria-label={t.participants}>
        <h2 className="rm-side-title">{t.participants}</h2>
        <ul className="rm-people">
          {members.map((member) => {
            const p = presence[member.id];
            const status = !p?.online && !p?.working ? t.offline : p?.working ? (p.note ?? t.working) : t.idle;
            return (
              <li key={member.id} className="rm-person">
                <AgentFigure size={52} look={member.look} state={stateOf(member)} />
                <div className="min-w-0 flex-1">
                  <div className="rm-person-name">{member.name}</div>
                  {member.role && <div className="rm-person-role">{member.role}</div>}
                  <div className={`rm-person-status ${p?.working ? "is-working" : ""}`}>
                    <span className={`cx-state ${p?.working ? "s" : p?.online ? "g" : ""}`} aria-hidden />
                    <span className="truncate">{status}</span>
                  </div>
                </div>
                <Link href={`/agents/${member.id}`} className="cx-back" aria-label={`${t.openChat}: ${member.name}`} title={t.openChat}>
                  <MessageCircle size={16} aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="rm-side-note">{t.mentionHint}</p>
        <p className="rm-side-note">{t.talkNote(ceiling)}</p>
        <div className="mt-auto pt-3">
          <ConfirmButton
            label={t.deleteRoom}
            question={t.deleteConfirm}
            onConfirm={async () => {
              const result = await removeRoom(room.id);
              if (result.ok) router.push("/rooms");
            }}
          />
        </div>
      </aside>
    </div>
  );
}
