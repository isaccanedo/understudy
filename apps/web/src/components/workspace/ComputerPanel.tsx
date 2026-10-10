import { GraduationCap, Maximize2, Minimize2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AgentState } from "@understudy/protocol";
import { AgentFigure } from "@/components/AgentFigure";
import { ComputerScreen } from "@/components/live/ComputerScreen";
import type { AgentLink, Frame } from "@/components/live/useAgentSocket";
import { cleanLook, type Look } from "@/lib/look";
import { messages } from "@/lib/messages";

const t = messages.live;
const a = messages.agentPage;

export function computerStatusText(live: AgentLink["live"], state: AgentState) {
  if (live.online) return `${messages.states[state]}${live.note ? ` · ${live.note}` : ""}`;
  if (live.computerStatus === "starting" || live.computerStatus === "pending" || live.computerStatus === "sleeping") return messages.home.computer[live.computerStatus];
  return t.offline;
}

export function ComputerPanel({
  agent,
  link,
  state,
  owner,
  ownerInitials,
  subscribeFrames,
  onClose,
}: {
  agent: { id: string; name: string; look: Look };
  link: Pick<AgentLink, "live" | "send">;
  state: AgentState;
  owner: boolean;
  ownerInitials: string;
  subscribeFrames: (listener: (frame: Frame) => void) => () => void;
  onClose: () => void;
}) {
  const { live, send } = link;
  const [controlling, setControlling] = useState(false);
  const [full, setFull] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inControl = controlling && live.online;

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === panelRef.current && panelRef.current !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!live.online) setControlling(false);
  }, [live.online]);

  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void panelRef.current?.requestFullscreen?.().catch(() => {});
  }

  const headline = inControl ? a.youAreInControl : computerStatusText(live, state);

  return (
    <div
      ref={panelRef}
      className={`computer-panel pc-frame ${full ? "is-full" : ""} ${inControl ? "is-yours" : ""}`}
      style={{ "--agent": cleanLook(agent.look).color } as CSSProperties}
    >
      <div className="pc-ring">
        <div className="pc-top">
          <span className={`pc-dot ${live.online ? "on" : ""}`} aria-hidden />
          <span className="truncate">{a.computerOf(agent.name)} · {headline}</span>
          <div className="pc-top-actions">
            <button type="button" className="pc-mini" onClick={toggleFull} aria-label={full ? t.exitFullScreen : t.fullScreen} title={full ? t.exitFullScreen : t.fullScreen}>
              {full ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />}
            </button>
            {!full && (
              <button type="button" className="pc-mini" onClick={onClose} aria-label={a.closeComputer} title={a.closeComputer}>
                <X size={13} aria-hidden />
              </button>
            )}
          </div>
        </div>
        <ComputerScreen
          subscribeFrames={subscribeFrames}
          sendInput={(event) => send({ type: "input", event })}
          controlling={inControl}
          online={live.online}
          url={live.url}
          look={agent.look}
        />
      </div>
      {live.error && <div className="err">{live.error}</div>}
      {owner && live.online && (
        <div className="pc-control" role="group" aria-label={a.control}>
          {inControl ? (
            <>
              <span className="pc-you" aria-hidden>
                {ownerInitials}
              </span>
              <span>
                <strong>{a.you}</strong> {a.haveControl}
              </span>
              <button type="button" className="btn pc-agent-btn" onClick={() => setControlling(false)}>
                {a.returnControl}
              </button>
            </>
          ) : (
            <>
              <AgentFigure size={24} look={agent.look} state={state} />
              <span>
                <strong>{agent.name}</strong> {a.hasControl}
              </span>
              {state === "working" && (
                <button type="button" className="btn sec" onClick={() => send({ type: "stop" })}>
                  {a.stop}
                </button>
              )}
              <button type="button" className="btn pri" onClick={() => setControlling(true)}>
                {a.takeOver}
              </button>
              {!full && (
                <>
                  <span className="pc-control-sep" aria-hidden />
                  <Link href={`/agents/${agent.id}/teach`} className="btn sec">
                    <GraduationCap size={14} aria-hidden />
                    {t.teach}
                  </Link>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
