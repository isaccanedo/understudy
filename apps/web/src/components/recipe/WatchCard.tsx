"use client";

import { useState, useTransition } from "react";
import { setRecipeWatch } from "@/app/actions/recipes";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";
import { Select } from "@/components/ui/Select";
import { WATCH_INTERVALS } from "@/lib/watch";

const t = messages.recipe;

export type WatchState = { url: string; part: string | null; everyMinutes: number; lastError: string | null; lastChange: string | null; lastChecked: string | null } | null;

export function WatchCard({ recipeId, initial, onState }: { recipeId: string; initial: WatchState; onState?: (on: boolean) => void }) {
  const [watching, setWatching] = useState(Boolean(initial));
  const [url, setUrl] = useState(initial?.url ?? "");
  const [part, setPart] = useState(initial?.part ?? "");
  const [every, setEvery] = useState(initial?.everyMinutes ?? 15);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await setRecipeWatch(recipeId, { url, part, everyMinutes: every });
      if (!result.ok) {
        setError(result.reason === "blocked" ? t.watchBlocked : t.watchInvalid);
        return;
      }
      setWatching(true);
      onState?.(true);
      if (result.watch) setUrl(result.watch.url);
    });

  const stop = () =>
    startTransition(async () => {
      await setRecipeWatch(recipeId, null);
      setWatching(false);
      onState?.(false);
      setError(null);
    });

  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-[12.5px] text-ash">{t.watchBody}</p>
      <form
        className="grid gap-3 text-[13px]"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="fld">
          <span className="fld-label">{t.watchUrl}</span>
          <Input type="url" inputMode="url" required placeholder="https://" value={url} maxLength={2000} disabled={pending} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="fld">
          <span className="fld-label">{t.watchPart}</span>
          <Input placeholder={t.watchPartHint} value={part} maxLength={300} disabled={pending} onChange={(event) => setPart(event.target.value)} />
        </label>
        <label className="fld">
          <span className="fld-label">{t.watchEvery}</span>
          <Select
            aria-label={t.watchEvery}
            value={String(every)}
            disabled={pending}
            onChange={(next) => setEvery(Number(next))}
            options={WATCH_INTERVALS.map((minutes) => ({ value: String(minutes), label: t.watchEveryLabel(minutes) }))}
          />
        </label>
        {error && (
          <p role="alert" className="m-0 text-[12.5px] text-coral">
            {error}
          </p>
        )}
        {watching && !error && <p className="m-0 text-[12.5px] text-mist">{t.watchOn}</p>}
        {watching && initial?.lastError && <p className="m-0 text-[12px] text-coral">{t.watchLastError(initial.lastError)}</p>}
        {watching && initial?.lastChecked && !initial.lastError && <p className="m-0 text-[12px] text-smoke">{t.watchLastChecked(initial.lastChecked)}</p>}
        {watching && initial?.lastChange && <p className="m-0 text-[12px] text-smoke">{t.watchLastChange(initial.lastChange)}</p>}
        <div className="flex gap-2">
          <button type="submit" className="btn sec sm" disabled={pending || !url.trim()}>
            {t.watchSave}
          </button>
          {watching && (
            <button type="button" className="btn sec sm" disabled={pending} onClick={stop}>
              {t.watchOff}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
