export type ChatItem = { id: string; role: "agent" | "user" | "activity" | "system"; text: string; at: string; via?: string | null };

export type ChatRow<T extends ChatItem> =
  | { kind: "day"; key: string; at: string }
  | { kind: "message"; key: string; entry: T; continued: boolean }
  | { kind: "steps"; key: string; entries: T[] };

const SAME_TURN_MS = 5 * 60 * 1000;

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function chatRows<T extends ChatItem>(entries: T[]): ChatRow<T>[] {
  const rows: ChatRow<T>[] = [];
  let lastDay = "";
  let previous: T | null = null;
  for (const entry of entries) {
    const day = dayKey(entry.at);
    if (day !== lastDay) {
      rows.push({ kind: "day", key: `day-${entry.id}`, at: entry.at });
      lastDay = day;
      previous = null;
    }
    const last = rows[rows.length - 1];
    if (entry.role === "activity") {
      if (last?.kind === "steps") last.entries.push(entry);
      else rows.push({ kind: "steps", key: `steps-${entry.id}`, entries: [entry] });
      continue;
    }
    const continued =
      previous !== null &&
      previous.role === entry.role &&
      entry.role !== "system" &&
      last?.kind === "message" &&
      (previous.via ?? null) === (entry.via ?? null) &&
      new Date(entry.at).getTime() - new Date(previous.at).getTime() < SAME_TURN_MS;
    rows.push({ kind: "message", key: entry.id, entry, continued });
    previous = entry;
  }
  return rows;
}

export const CHAT_WIDTH = { min: 320, max: 720, fallback: 400, step: 16, bigStep: 64, minScreen: 360 } as const;

export function clampChatWidth(width: number, viewport?: number) {
  const ceiling = viewport ? Math.max(CHAT_WIDTH.min, Math.min(CHAT_WIDTH.max, viewport - CHAT_WIDTH.minScreen)) : CHAT_WIDTH.max;
  if (!Number.isFinite(width)) return CHAT_WIDTH.fallback;
  return Math.round(Math.min(ceiling, Math.max(CHAT_WIDTH.min, width)));
}

export function parseStoredWidth(raw: string | null | undefined) {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? clampChatWidth(value) : null;
}

export const CHAT_WIDTH_COOKIE = "understudy_chat_w";

export const WORKSPACE_HIDDEN_COOKIE = "understudy_ws_hidden";
