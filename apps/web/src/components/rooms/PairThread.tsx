"use client";

import { ArrowLeft, MessageCircle, Play, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { AgentState } from "@understudy/protocol";
import { setPairTalk } from "@/app/actions/rooms";
import { AgentFigure } from "@/components/AgentFigure";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DayDivider, MessageRow } from "@/components/inside/ChatParts";
import type { AgentMessageKind } from "@/lib/db/schema";
import type { Look } from "@/lib/look";
import { messages } from "@/lib/messages";
import { roomRows } from "@/lib/rooms";
import type { ChatEntry } from "@/server/hub-types";

export type PairAgentView = { id: string; name: string; role: string; look: Look; state: AgentState; open: boolean };

export type PairEntry = { id: string; kind: AgentMessageKind; agentId: string; text: string; task: string | null; runId: string | null; delivered: boolean; at: string };

type Item = { id: string; author: "agent" | "system"; agentId: string | null; text: string; at: string; source: PairEntry };

function asItem(entry: PairEntry): Item {
  const t = messages.rooms;
  if (entry.kind === "stop" || entry.kind === "resume") {
    return { id: entry.id, author: "system", agentId: null, text: entry.kind === "stop" ? t.pairStoppedLine : t.pairResumedLine, at: entry.at, source: entry };
  }
  const text = entry.kind === "handoff" ? `**${t.handoffLine(entry.task ?? "")}**\n\n${entry.text}` : entry.text;
  return { id: entry.id, author: "agent", agentId: entry.agentId, text, at: entry.at, source: entry };
}

function asChat(item: Item): ChatEntry {
  return { id: item.id, role: item.author, text: item.text, at: item.at };
}

export function PairThread({
  agents,
  entries,
  stopped,
  canStop,
  roomHref,
  ceiling,
}: {
  agents: PairAgentView[];
  entries: PairEntry[];
  stopped: boolean;
  canStop: boolean;
  roomHref: string | null;
  ceiling: number | null;
}) {
  const t = messages.rooms;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const byId = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const rows = useMemo(() => roomRows(entries.map(asItem)), [entries]);
  const title = t.pairName(agents[0].name, agents[1].name);

  function toggle(next: boolean) {
    setFailed(false);
    start(async () => {
      const result = await setPairTalk({ a: agents[0].id, b: agents[1].id, stopped: next });
      if (!result.ok) setFailed(true);
      router.refresh();
    });
  }

  return (
    <div className="rm-layout">
      <AutoRefresh seconds={5} />
      <section className="cx-col rm-col" aria-label={title}>
        <header className="cx-head">
          <Link href="/rooms" aria-label={messages.common.back} className="cx-back">
            <ArrowLeft size={17} aria-hidden />
          </Link>
          <span className="rm-stack" aria-hidden>
            {agents.map((agent) => (
              <span key={agent.id} className="rm-stack-item">
                <AgentFigure size={30} look={agent.look} state={agent.state} />
              </span>
            ))}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="cx-title">{title}</h1>
            <div className="cx-subtitle">
              <span className={`cx-state ${stopped ? "" : "g"}`} aria-hidden />
              <span className="truncate">{stopped ? t.stoppedTag : t.pairTag}</span>
            </div>
          </div>
          {canStop &&
            (stopped ? (
              <button type="button" className="btn sec" onClick={() => toggle(false)} disabled={pending} aria-label={t.resume} title={t.resume}>
                <Play size={13} aria-hidden />
                <span className="max-[600px]:hidden">{t.resume}</span>
              </button>
            ) : (
              <button type="button" className="rm-stop" onClick={() => toggle(true)} disabled={pending} title={t.stopPairHint}>
                <Square size={12} fill="currentColor" aria-hidden />
                {t.stop}
              </button>
            ))}
        </header>
        <div className="cx-list scroll-thin" aria-live="polite">
          {rows.length === 0 && (
            <div className="cx-empty">
              <span className="rm-stack" aria-hidden>
                {agents.map((agent) => (
                  <span key={agent.id} className="rm-stack-item">
                    <AgentFigure size={48} look={agent.look} />
                  </span>
                ))}
              </span>
              <p>{t.pairEmpty}</p>
            </div>
          )}
          {rows.map((row) => {
            if (row.kind === "day") return <DayDivider key={row.key} at={row.at} />;
            const agent = row.entry.agentId ? byId.get(row.entry.agentId) : undefined;
            const source = row.entry.source;
            return (
              <div key={row.key} className="contents">
                <MessageRow entry={asChat(row.entry)} continued={row.continued} agentName={agent?.name ?? t.someoneWhoLeft} look={agent?.look ?? ({} as Look)} />
                {row.entry.author === "agent" && (source.runId || !source.delivered) && (
                  <div className="rm-thread-extra">
                    {source.runId && (
                      <Link href={`/runs/${source.runId}`} className="text-sky">
                        {t.openRun}
                      </Link>
                    )}
                    {!source.delivered && <span className="text-coral">{t.notDelivered}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {failed && <div className="err mx-3">{messages.common.error}</div>}
        <div className="rm-pair-foot">
          {stopped ? <p className="rm-pair-stopped">{t.pairStoppedNote}</p> : <p>{t.pairOnlyThem}</p>}
          {roomHref && (
            <Link href={roomHref} className="btn sec">
              {t.roomWithThem}
            </Link>
          )}
        </div>
      </section>

      <aside className="rm-side" aria-label={t.pairTag}>
        <h2 className="rm-side-title">{t.pairTag}</h2>
        <ul className="rm-people">
          {agents.map((agent) => (
            <li key={agent.id} className="rm-person">
              <AgentFigure size={52} look={agent.look} state={agent.state} />
              <div className="min-w-0 flex-1">
                <div className="rm-person-name">{agent.name}</div>
                {agent.role && <div className="rm-person-role">{agent.role}</div>}
              </div>
              {agent.open && (
                <Link href={`/agents/${agent.id}`} className="cx-back" aria-label={`${t.openChat}: ${agent.name}`} title={t.openChat}>
                  <MessageCircle size={16} aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ul>
        {canStop && <p className="rm-side-note">{stopped ? t.pairStoppedNote : t.stopPairHint}</p>}
        <p className="rm-side-note">{t.talkNote(ceiling)}</p>
      </aside>
    </div>
  );
}
