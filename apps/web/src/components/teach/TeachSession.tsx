"use client";

import type { Look } from "@/lib/look";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AgentState, RecordedEvent } from "@understudy/protocol";
import { AgentFigure } from "@/components/AgentFigure";
import { ComputerScreen } from "@/components/live/ComputerScreen";
import { useAgentSocket } from "@/components/live/useAgentSocket";
import { useSpeech } from "@/components/live/useSpeech";
import type { BrainStatus } from "@/lib/db/schema";
import { agentTabPath } from "@/lib/workspace-tabs";
import { messages } from "@/lib/messages";
import { Input, Textarea } from "@/components/ui/controls";

const t = messages.teach;

type Step = { key: string; kind: "action" | "say"; text: string; detail?: string };

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function stepsFromEvents(events: RecordedEvent[]): Step[] {
  const steps: Step[] = [];
  events.forEach((event, index) => {
    const key = `${index}`;
    switch (event.kind) {
      case "navigate":
        if (steps.at(-1)?.detail === event.url) return;
        steps.push({ key, kind: "action", text: t.navigatedTo(event.title || hostOf(event.url)), detail: event.url });
        return;
      case "click":
        steps.push({ key, kind: "action", text: t.clicked(event.label || event.selector), detail: hostOf(event.url) });
        return;
      case "input": {
        const text = t.typed(event.label || event.selector);
        const value = event.masked ? t.masked : event.value;
        const last = steps.at(-1);
        if (last && last.kind === "action" && last.text === text) {
          last.detail = value;
          return;
        }
        steps.push({ key, kind: "action", text, detail: value });
        return;
      }
      case "select":
        steps.push({ key, kind: "action", text: t.selected(event.label || event.selector, event.value) });
        return;
      case "key":
        if (event.key === "Enter" || event.key === "Tab" || event.key === "Escape") steps.push({ key, kind: "action", text: t.pressed(event.key) });
        return;
      case "narration":
        steps.push({ key, kind: "say", text: `“${event.text}”` });
        return;
      default:
        return;
    }
  });
  return steps;
}

function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function TeachSession({
  agent,
  initialEvents,
}: {
  agent: { id: string; name: string; look: Look; state: AgentState; computerStatus: string; brains: BrainStatus[] };
  initialEvents: RecordedEvent[];
}) {
  const router = useRouter();
  const [events, setEvents] = useState<RecordedEvent[]>(initialEvents);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [narration, setNarration] = useState("");
  const [description, setDescription] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const { live, send, subscribeFrames } = useAgentSocket(
    agent.id,
    { state: agent.state, note: null, computerStatus: agent.computerStatus, brains: agent.brains },
    {
      onRecorded: (event) => setEvents((list) => [...list, event]),
      onRecipeFailed: (_, error) => setFailure(t.failed(error)),
    },
  );

  const recording = live.recordingStatus === "recording";
  const processing = live.recordingStatus === "processing" && !failure;
  const brainReady = live.brains.some((b) => b.loggedIn);

  useEffect(() => {
    if (!processing) return;
    const timer = setTimeout(() => setFailure(t.timedOut), 4 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [processing]);

  useEffect(() => {
    if (recording && startedAt === null) setStartedAt(Date.now());
    if (!recording) setStartedAt(null);
  }, [recording, startedAt]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (live.recipe) router.push(`/agents/${agent.id}/recipes/${live.recipe.recipeId}`);
  }, [live.recipe, agent.id, router]);

  function narrate(text: string) {
    const clean = text.trim();
    if (!clean || !recording) return;
    send({ type: "record_narration", text: clean });
  }

  const speech = useSpeech(narrate);

  useEffect(() => {
    if (!recording && speech.listening) speech.stop();
  }, [recording, speech]);

  const steps = useMemo(() => stepsFromEvents(events), [events]);
  const face: AgentState = processing ? "thinking" : recording ? "listening" : "calm";
  let actionNumber = 0;

  return (
    <div className="grid grid-cols-[1fr_340px] h-screen max-[1000px]:grid-cols-1 max-[1000px]:h-auto">
      <div className="flex flex-col pl-[22px] pr-[18px] py-[18px] gap-3 min-h-0 max-[1000px]:h-[80vh]">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href={`/agents/${agent.id}`} aria-label={messages.common.back} className="text-ash hover:text-mist no-underline inline-flex">
            <ArrowLeft size={18} aria-hidden />
          </Link>
          <div
            className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 font-semibold text-[12.5px] ${recording ? "bg-ember text-coral" : "bg-graphite text-ash"}`}
          >
            <span className={`rec-dot ${recording ? "on" : ""}`} style={recording ? undefined : { background: "var(--iron)", boxShadow: "none" }} />
            {recording ? `${t.recording} · ${elapsed(now - (startedAt ?? now))}` : processing ? t.processing : t.idle}
          </div>
          <span className="text-[13px] text-ash">{t.instruction}</span>
          <div className="ml-auto flex gap-2">
            {recording ? (
              <button className="btn pri" onClick={() => send({ type: "record_stop" })}>
                {t.finish}
              </button>
            ) : (
              <button
                className="btn warn"
                disabled={!live.online || processing || !brainReady}
                onClick={() => {
                  setEvents([]);
                  setFailure(null);
                  send({ type: "record_start" });
                }}
              >
                {t.start}
              </button>
            )}
          </div>
        </div>
        {live.error && <div className="err">{live.error}</div>}
        {failure && <div className="err">{failure}</div>}
        {live.online && !brainReady && (
          <div className="err">
            {t.noBrain}{" "}
            <Link href={agentTabPath(agent.id, "settings")} className="underline">
              {t.connectBrain}
            </Link>
          </div>
        )}
        <ComputerScreen
          subscribeFrames={subscribeFrames}
          sendInput={(event) => send({ type: "input", event })}
          controlling={live.online}
          online={live.online}
          url={live.url}
          label={t.computerOf(agent.name)}
          look={agent.look}
        />
      </div>

      <aside className="bg-void border-l border-graphite flex flex-col min-h-0 max-[1000px]:h-[70vh]">
        <div className="p-[18px] flex gap-3 items-center border-b border-graphite">
          <AgentFigure state={face} size={44} look={agent.look} />
          <div>
            <h3 className="m-0 text-[15px] font-semibold">{agent.name}</h3>
            <div className="muted text-[12px]">{processing ? t.understanding : recording ? t.watching : t.ready}</div>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-[18px] py-3.5 flex flex-col gap-2.5">
          {steps.length === 0 && <div className="text-smoke text-[12.5px]">{t.noSteps}</div>}
          {!recording && steps.length === 0 && (
            <form
              className="flex flex-col gap-2 mt-2 border-t border-graphite pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const text = description.trim();
                if (!text) return;
                setFailure(null);
                if (send({ type: "teach_text", text })) setDescription("");
              }}
            >
              <div className="text-[13px] font-semibold">{t.describeTitle}</div>
              <div className="text-[12px] text-smoke">{t.describeHint}</div>
              <Textarea
                size="sm"
                aria-label={t.describeTitle}
                className="resize-none [field-sizing:content] !min-h-[120px]"
                placeholder={t.describePlaceholder}
                value={description}
                disabled={processing || !live.online}
                onChange={(e) => setDescription(e.target.value)}
              />
              <button type="submit" className="btn sec sm self-start" disabled={processing || !live.online || !brainReady || !description.trim()}>
                {t.describeSubmit}
              </button>
            </form>
          )}
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1 && recording && step.kind === "action";
            if (step.kind === "action") actionNumber += 1;
            return (
              <div key={step.key} className="grid grid-cols-[22px_1fr] gap-2.5 text-[12.5px]">
                <div
                  className={`w-[22px] h-[22px] rounded-full grid place-items-center text-[11px] ${isLast ? "bg-coral text-white" : "bg-graphite text-ash"}`}
                >
                  {step.kind === "say" ? "“" : actionNumber}
                </div>
                <div className="min-w-0">
                  <div className={step.kind === "say" ? "text-sky" : "text-mist"}>{step.text}</div>
                  {step.detail && <div className="text-smoke text-[11.5px] mt-0.5 truncate">{step.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mx-[18px] mb-[18px] mt-3 rounded-[14px] bg-obsidian border border-line p-3 flex flex-col gap-2.5">
          <div className="flex gap-3 items-center">
            <button
              type="button"
              className="bg-transparent border-0 p-0 cursor-pointer disabled:cursor-default"
              disabled={!recording || !speech.supported}
              aria-pressed={speech.listening}
              aria-label={speech.listening ? t.micOn : t.micOff}
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
            >
              <div className={`wave ${speech.listening ? "on" : ""}`}>
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </button>
            <p className="m-0 text-[12.5px] text-ash">
              {speech.interim ? speech.interim : !speech.supported ? t.micUnsupported : speech.listening ? t.mic : t.micOff}
            </p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              narrate(narration);
              setNarration("");
            }}
          >
            <Input
              size="sm"
              aria-label={t.narrationPlaceholder}
              placeholder={t.narrationPlaceholder}
              value={narration}
              disabled={!recording}
              onChange={(e) => setNarration(e.target.value)}
            />
            <button type="submit" className="btn sec sm" disabled={!recording || !narration.trim()}>
              {t.narrationSend}
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}
