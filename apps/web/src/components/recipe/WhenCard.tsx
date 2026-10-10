"use client";

import { useMemo } from "react";
import { Cron } from "croner";
import { SchedulePicker } from "@/components/recipe/SchedulePicker";
import { currentLocale, messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";

const t = messages.recipe;

export function nextRun(cron: string, timezone: string) {
  if (!cron.trim()) return null;
  try {
    const job = new Cron(cron.trim(), { timezone, paused: true });
    const next = job.nextRun();
    job.stop();
    return next;
  } catch {
    return undefined;
  }
}

export function formatNext(next: Date, timezone: string) {
  return next.toLocaleString(currentLocale(), { timeZone: timezone, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function WhenCard({
  cron,
  timezone,
  onCron,
  onTimezone,
}: {
  cron: string;
  timezone: string;
  onCron: (value: string) => void;
  onTimezone: (value: string) => void;
}) {
  const next = useMemo(() => nextRun(cron, timezone), [cron, timezone]);

  return (
    <div className="grid gap-3 text-[13px]">
      <SchedulePicker cron={cron} onChange={onCron} />
      <label className="fld">
        <span className="fld-label">{t.timezone}</span>
        <Input value={timezone} onChange={(e) => onTimezone(e.target.value)} />
      </label>
      <div className="flex justify-between bg-graphite rounded-[10px] px-3 py-2.5">
        <span>
          {next === undefined
            ? t.cronInvalid
            : next === null
              ? t.manualOnly
              : t.nextRun(formatNext(next, timezone))}
        </span>
      </div>
    </div>
  );
}
