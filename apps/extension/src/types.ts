export type Pairing = { serverUrl: string; token: string; userName: string; userEmail: string; productName: string };

export type Agent = { id: string; name: string; role: string; online: boolean; avatarUrl: string };

export type Phase = "idle" | "starting" | "recording" | "paused" | "finishing" | "processing" | "done" | "failed";

export type Session = {
  phase: Phase;
  recordingId: string | null;
  agentId: string | null;
  agentName: string | null;
  voice: boolean;
  startedAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  events: number;
  recipeId: string | null;
  error: string | null;
};

export type Status = {
  config: { serverUrl: string; productName: string };
  pairing: Omit<Pairing, "token"> | null;
  session: Session;
  level: number;
};

export type PopupRequest =
  | { type: "status" }
  | { type: "pair"; serverUrl: string; code: string }
  | { type: "unpair" }
  | { type: "agents" }
  | { type: "start"; agentId: string; voice: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "discard" }
  | { type: "reset" };

export type ContentRequest =
  | { type: "captured"; payload: string }
  | { type: "hello" }
  | { type: "indicator"; action: "pause" | "resume" | "stop" };

export type OffscreenReport = { type: "audio-level"; level: number } | { type: "audio-problem"; error: string };

export type OffscreenCommand =
  | { target: "offscreen"; type: "audio-start"; serverUrl: string; token: string; recordingId: string }
  | { target: "offscreen"; type: "audio-pause" }
  | { target: "offscreen"; type: "audio-resume" }
  | { target: "offscreen"; type: "audio-stop" };

export type ContentCommand = { type: "recorder"; on: boolean; paused: boolean; ended: boolean; agentName: string | null };

export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
