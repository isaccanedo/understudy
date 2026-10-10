import { serverLocale } from "./messages";

const timeZone = process.env.UNDERSTUDY_TIMEZONE ?? "UTC";

export function formatWhen(date: Date | string | null | undefined) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(serverLocale(), { hour: "2-digit", minute: "2-digit", timeZone });
  if (sameDay) return time;
  const day = d.toLocaleDateString(serverLocale(), { weekday: "short", day: "2-digit", month: "2-digit", timeZone });
  return `${day} ${time}`;
}

export function formatDate(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(serverLocale(), { day: "2-digit", month: "short", timeZone });
}

export function formatTime(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString(serverLocale(), { hour: "2-digit", minute: "2-digit", timeZone });
}
