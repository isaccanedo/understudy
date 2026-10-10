import type { Session } from "./types.ts";

export const INDICATOR_ID = "understudy-rec-pill";
export const CLIP_MS = 4 * 60 * 1000;
export const BATCH_SIZE = 100;

export function idleSession(): Session {
  return { phase: "idle", recordingId: null, agentId: null, agentName: null, voice: true, startedAt: null, pausedAt: null, pausedMs: 0, events: 0, recipeId: null, error: null };
}

export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const local = url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isRecordableUrl(url: string | undefined, serverUrl: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (serverUrl && parsed.origin === new URL(serverUrl).origin) return false;
    return true;
  } catch {
    return false;
  }
}

export function fromIndicator(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload) as { selector?: unknown };
    return typeof parsed.selector === "string" && parsed.selector.includes(INDICATOR_ID);
  } catch {
    return false;
  }
}

export function elapsedMs(session: Session, now: number): number {
  if (!session.startedAt) return 0;
  const pausedNow = session.pausedAt ? now - session.pausedAt : 0;
  return Math.max(0, now - session.startedAt - session.pausedMs - pausedNow);
}

export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export class EventBuffer<T> {
  private items: T[] = [];
  private limit: number;

  constructor(limit = 5000) {
    this.limit = limit;
  }

  push(item: T) {
    if (this.items.length >= this.limit) return false;
    this.items.push(item);
    return true;
  }

  get size() {
    return this.items.length;
  }

  take(count = BATCH_SIZE): T[] {
    return this.items.slice(0, count);
  }

  drop(count: number) {
    this.items.splice(0, count);
  }

  clear() {
    this.items = [];
  }
}

export function lastNavigation() {
  const byTab = new Map<number, string>();
  return {
    changed(tabId: number, url: string) {
      if (byTab.get(tabId) === url) return false;
      byTab.set(tabId, url);
      return true;
    },
    forget(tabId: number) {
      byTab.delete(tabId);
    },
    clear() {
      byTab.clear();
    },
  };
}

export function apiError(status: number, body: unknown): string {
  const code = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "";
  if (status === 401) return "unauthorized";
  if (status === 429) return "too_many_requests";
  return code || `http_${status}`;
}
