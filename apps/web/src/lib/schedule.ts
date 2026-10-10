export type ScheduleMode = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";

export type Schedule = { mode: ScheduleMode; time: string; weekday: number; monthday: number; custom: string };

const pad = (n: number) => String(n).padStart(2, "0");

export function parseCron(cron: string): Schedule {
  const base: Schedule = { mode: "none", time: "08:00", weekday: 1, monthday: 1, custom: cron };
  const value = cron.trim();
  if (!value) return base;
  const parts = value.split(/\s+/);
  if (parts.length !== 5) return { ...base, mode: "custom" };
  const [minute, hour, day, month, weekday] = parts;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || month !== "*") return { ...base, mode: "custom" };
  const time = `${pad(Number(hour))}:${pad(Number(minute))}`;
  if (day === "*" && weekday === "*") return { ...base, mode: "daily", time };
  if (day === "*" && weekday === "1-5") return { ...base, mode: "weekdays", time };
  if (day === "*" && /^[0-6]$/.test(weekday)) return { ...base, mode: "weekly", time, weekday: Number(weekday) };
  if (/^\d+$/.test(day) && weekday === "*") return { ...base, mode: "monthly", time, monthday: Number(day) };
  return { ...base, mode: "custom" };
}

export function toCron(schedule: Schedule): string {
  const [hour, minute] = schedule.time.split(":").map((n) => Number(n) || 0);
  switch (schedule.mode) {
    case "none":
      return "";
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${schedule.weekday}`;
    case "monthly":
      return `${minute} ${hour} ${Math.min(28, Math.max(1, schedule.monthday))} * *`;
    case "custom":
      return schedule.custom.trim();
  }
}
