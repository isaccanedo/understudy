"use client";

import { messages } from "@/lib/messages";
import { Input, Switch } from "@/components/ui/controls";

const t = messages.recipe;

export function AskCard({
  askFirstRuns,
  runsDone,
  askAlways,
  onAskFirstRuns,
  onAskAlways,
}: {
  askFirstRuns: number;
  runsDone: number;
  askAlways: boolean;
  onAskFirstRuns: (value: number) => void;
  onAskAlways: (value: boolean) => void;
}) {
  return (
    <section className="card rp-card" aria-labelledby="rp-ask">
      <h2 id="rp-ask" className="rp-h2">
        {t.askTitle}
      </h2>
      <p className={`m-0 text-[13.5px] leading-[2.1] ${askAlways ? "text-smoke" : ""}`}>
        {t.askLead}{" "}
        <Input
          type="number"
          size="sm"
          min={0}
          max={100}
          aria-label={t.askFirstRuns}
          disabled={askAlways}
          className="!inline-block !w-[60px] !min-h-[30px] !py-0.5 text-center align-middle"
          value={askFirstRuns}
          onChange={(e) => onAskFirstRuns(Number(e.target.value))}
        />{" "}
        {t.askTail}
        {askFirstRuns > 0 && !askAlways && <span className="text-smoke"> {t.askProgress(Math.min(runsDone, askFirstRuns), askFirstRuns)}</span>}
      </p>
      <Switch label={t.askAlways} hint={t.askFine} checked={askAlways} onChange={(e) => onAskAlways(e.target.checked)} />
    </section>
  );
}
