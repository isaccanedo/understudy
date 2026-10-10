"use client";

import type { Look } from "@/lib/look";
import { ArrowLeft, Monitor, Puzzle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AgentState, RecordedEvent } from "@understudy/protocol";
import { AgentFigure } from "@/components/AgentFigure";
import { useAgentSocket } from "@/components/live/useAgentSocket";
import type { BrainStatus } from "@/lib/db/schema";
import { messages } from "@/lib/messages";
import { stepsFromEvents } from "./TeachSession";

const t = messages.extension;

export function TeachChoice({
  agent,
  extensionConnected,
  initialEvents,
}: {
  agent: { id: string; name: string; look: Look; state: AgentState; computerStatus: string; brains: BrainStatus[] };
  extensionConnected: boolean;
  initialEvents: RecordedEvent[];
}) {
  const router = useRouter();
  const [events, setEvents] = useState<RecordedEvent[]>(initialEvents);
  const [failure, setFailure] = useState<string | null>(null);
  const { live } = useAgentSocket(
    agent.id,
    { state: agent.state, note: null, computerStatus: agent.computerStatus, brains: agent.brains },
    {
      onRecorded: (event) => {
        setFailure(null);
        setEvents((list) => [...list, event]);
      },
      onRecipeFailed: (_, error) => setFailure(error),
    },
  );

  useEffect(() => {
    if (live.recipe) router.push(`/agents/${agent.id}/recipes/${live.recipe.recipeId}`);
  }, [live.recipe, agent.id, router]);

  const steps = useMemo(() => stepsFromEvents(events), [events]);
  const processing = live.recordingStatus === "processing" && !failure;
  const actions = steps.filter((step) => step.kind === "action").length;
  const face: AgentState = processing ? "thinking" : events.length ? "listening" : "calm";

  return (
    <div className="sky-page min-h-screen px-6 py-6 max-[700px]:px-4">
      <div className="max-w-[920px] mx-auto flex flex-col gap-6">
        <Link href={`/agents/${agent.id}`} aria-label={messages.common.back} className="text-ash hover:text-mist no-underline inline-flex self-start">
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <div className="flex items-center gap-4">
          <AgentFigure state={face} size={64} look={agent.look} />
          <div>
            <h1 className="m-0 text-[24px] font-semibold tracking-[-0.03em]">{t.chooseTitle(agent.name)}</h1>
            <p className="m-0 text-smoke text-[13px]">{t.chooseSubtitle}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
          <section className="card p-5 flex flex-col gap-3 border-[rgb(255_255_255/.22)]">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full bg-white text-ink grid place-items-center" aria-hidden>
                <Puzzle size={17} />
              </span>
              <h2 className="m-0 text-[16px] font-semibold tracking-[-0.02em]">{t.browserOption}</h2>
              <span className="pill g ml-auto">{t.recommended}</span>
            </div>
            <p className="m-0 text-[13px] text-ash">{t.browserOptionBody}</p>
            {extensionConnected ? (
              <p className="m-0 text-[13px] text-green">{t.browserReady}</p>
            ) : (
              <Link href={`/extension?agent=${agent.id}`} className="btn pri self-start">
                {t.browserSetup}
              </Link>
            )}
          </section>
          <section className="card p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full bg-graphite text-mist grid place-items-center" aria-hidden>
                <Monitor size={17} />
              </span>
              <h2 className="m-0 text-[16px] font-semibold tracking-[-0.02em]">{t.remoteOption(agent.name)}</h2>
            </div>
            <p className="m-0 text-[13px] text-ash">{t.remoteOptionBody}</p>
            <Link href={`/agents/${agent.id}/teach?mode=remote`} className="btn sec self-start">
              {t.remoteStart}
            </Link>
          </section>
        </div>

        <section className="card p-5 flex flex-col gap-3" aria-live="polite">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="m-0 text-[15px] font-semibold">{t.liveTitle}</h2>
            {(events.length > 0 || processing) && (
              <span className={`pill ${processing ? "s" : "c"}`}>
                <span className="dot" />
                {processing ? t.liveProcessing : t.liveRecording(actions)}
              </span>
            )}
          </div>
          {failure && <div className="err">{`${t.liveFailed} ${failure}`}</div>}
          {steps.length === 0 && <div className="text-smoke text-[12.5px]">{t.liveIdle}</div>}
          <ol className="list-none m-0 p-0 flex flex-col gap-2 max-h-[340px] overflow-y-auto scroll-thin">
            {steps.map((step) => (
              <li key={step.key} className="grid grid-cols-[18px_1fr] gap-2.5 text-[12.5px]">
                <span className={`mt-1.5 w-2 h-2 rounded-full ${step.kind === "say" ? "bg-sky" : "bg-iron"}`} aria-hidden />
                <div className="min-w-0">
                  <div className={step.kind === "say" ? "text-sky" : "text-mist"}>{step.text}</div>
                  {step.detail && <div className="text-smoke text-[11.5px] truncate">{step.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
