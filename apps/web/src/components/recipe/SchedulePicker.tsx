"use client";

import { useState } from "react";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";
import { Select } from "@/components/ui/Select";
import { parseCron, toCron, type Schedule, type ScheduleMode } from "@/lib/schedule";

export function SchedulePicker({ cron, onChange }: { cron: string; onChange: (cron: string) => void }) {
  const t = messages.schedule;
  const [schedule, setSchedule] = useState<Schedule>(() => parseCron(cron));
  const update = (patch: Partial<Schedule>) => {
    const next = { ...schedule, ...patch };
    setSchedule(next);
    onChange(toCron(next));
  };
  const modes: ScheduleMode[] = ["none", "daily", "weekdays", "weekly", "monthly", "custom"];
  return (
    <div className="flex flex-col gap-3">
      <label className="fld">
        <span className="fld-label">{t.how}</span>
        <Select aria-label={t.how} value={schedule.mode} onChange={(next) => update({ mode: next as ScheduleMode })} options={modes.map((mode) => ({ value: mode, label: t.modes[mode] }))} />
      </label>
      {schedule.mode === "weekly" && (
        <label className="fld">
          <span className="fld-label">{t.weekday}</span>
          <Select
            aria-label={t.weekday}
            value={String(schedule.weekday)}
            onChange={(next) => update({ weekday: Number(next) })}
            options={t.weekdays.map((name, index) => ({ value: String(index), label: name }))}
          />
        </label>
      )}
      {schedule.mode === "monthly" && (
        <label className="fld">
          <span className="fld-label">{t.monthday}</span>
          <Input
            type="number"
            min={1}
            max={28}
            value={schedule.monthday}
            onChange={(e) => update({ monthday: Number(e.target.value) })}
          />
        </label>
      )}
      {schedule.mode !== "none" && schedule.mode !== "custom" && (
        <label className="fld">
          <span className="fld-label">{t.time}</span>
          <Input type="time" value={schedule.time} onChange={(e) => update({ time: e.target.value })} />
        </label>
      )}
      {schedule.mode === "custom" && (
        <label className="fld">
          <span className="fld-label">{t.custom}</span>
          <Input className="font-mono" placeholder="0 8 * * 1" value={schedule.custom} onChange={(e) => update({ custom: e.target.value })} />
          <span className="fld-hint">{t.customHelp}</span>
        </label>
      )}
    </div>
  );
}
