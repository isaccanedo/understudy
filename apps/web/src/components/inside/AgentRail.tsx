import { Clock3, Plus, Settings } from "lucide-react";
import Link from "next/link";
import type { AgentState } from "@understudy/protocol";
import { AgentFigure } from "@/components/AgentFigure";
import type { Look } from "@/lib/look";
import { messages } from "@/lib/messages";

export type RailAgent = { id: string; name: string; look: Look; state: AgentState; note: string | null; waiting: number };

export type RailData = { agents: RailAgent[]; waiting: number; userName: string; productName: string };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function railLine(agent: Pick<RailAgent, "state" | "note" | "waiting">) {
  if (agent.waiting > 0) return messages.states.waiting_you;
  const state = messages.states[agent.state];
  const label = state.charAt(0).toUpperCase() + state.slice(1);
  return agent.note ? `${label} · ${agent.note}` : label;
}

export function AgentRail({ data, currentId, current, slim }: { data: RailData; currentId: string; current: { state: AgentState; note: string | null }; slim: boolean }) {
  const r = messages.agentPage;
  return (
    <nav className={`ar ${slim ? "is-slim" : ""}`} aria-label={r.railLabel}>
      <Link href="/" className="ar-brand" title={r.allAgents}>
        <AgentFigure size={26} live={false} />
        <span className="ar-text">{data.productName}</span>
      </Link>
      <Link href="/agents/new" className="ar-new" title={r.newAgent}>
        <Plus size={16} aria-hidden />
        <span className="ar-text">{r.newAgent}</span>
      </Link>
      <div className="ar-label ar-text">{messages.nav.agents}</div>
      <ul className="ar-agents scroll-thin">
        {data.agents.map((agent) => {
          const on = agent.id === currentId;
          const live = on ? { ...agent, ...current } : agent;
          return (
            <li key={agent.id}>
              <Link href={`/agents/${agent.id}`} className={`ar-agent ${on ? "is-on" : ""}`} aria-current={on ? "page" : undefined} title={agent.name}>
                <span className="ar-fig">
                  <AgentFigure size={30} look={agent.look} state={live.state} live={on} />
                  {agent.waiting > 0 && <span className="ar-badge">{agent.waiting}</span>}
                </span>
                <span className="ar-meta ar-text">
                  <span className="ar-name">{agent.name}</span>
                  <span className="ar-line">{railLine(live)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="ar-nav">
        <Link href="/waiting" className="ar-link" title={messages.nav.waiting}>
          <Clock3 size={16} aria-hidden />
          <span className="ar-text">{messages.nav.waiting}</span>
          {data.waiting > 0 && <span className="ar-count">{data.waiting}</span>}
        </Link>
        <Link href="/settings" className="ar-link" title={messages.nav.settings}>
          <Settings size={16} aria-hidden />
          <span className="ar-text">{messages.nav.settings}</span>
        </Link>
      </div>
      <div className="ar-who" title={data.userName}>
        <span className="av">{initials(data.userName)}</span>
        <span className="ar-text truncate">{data.userName}</span>
      </div>
    </nav>
  );
}

export { initials };
