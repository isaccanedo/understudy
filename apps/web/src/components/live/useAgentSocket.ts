"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Brain, AgentState, FileEntry, JobInfo, MemoryFile, RecordedEvent, Recipe } from "@understudy/protocol";
import type { BrainStatus } from "@/lib/db/schema";
import type { ApprovalView, ChatEntry, ServerToViewer, ViewerToServer } from "@/server/hub-types";

export type Frame = { jpegBase64: string; width: number; height: number; url: string; desktop?: boolean };

export type LoginPrompt = { brain: Brain; url?: string; code?: string; message: string };
export type LoginResult = { brain: Brain; ok: boolean; account?: string; message?: string };

export type LiveState = {
  connected: boolean;
  online: boolean;
  state: AgentState;
  note: string | null;
  computerStatus: string;
  computerMessage: string | null;
  brains: BrainStatus[];
  recordingId: string | null;
  recordingStatus: "recording" | "processing" | "done" | "failed" | null;
  recipe: { recipeId: string; recordingId: string; recipe: Recipe } | null;
  loginPrompt: LoginPrompt | null;
  loginResult: LoginResult | null;
  error: string | null;
  url: string;
};

type Initial = {
  state: AgentState;
  note: string | null;
  computerStatus: string;
  brains: BrainStatus[];
};

export type Handlers = {
  onChat?: (entry: ChatEntry) => void;
  onRecorded?: (event: RecordedEvent, seq: number, recordingId: string) => void;
  onApproval?: (approval: ApprovalView) => void;
  onApprovalClosed?: (id: string, status: string) => void;
  onRunFinished?: (runId: string, ok: boolean, summary: string) => void;
  onMemory?: (files: MemoryFile[]) => void;
  onFiles?: (files: FileEntry[]) => void;
  onCredentials?: (credentials: { name: string; username: string; site?: string }[]) => void;
  onRecipeFailed?: (recordingId: string, error: string) => void;
  onJobs?: (jobs: JobInfo[]) => void;
  onChatDelta?: (streamId: string, text: string) => void;
  onTerminal?: (message: { type: "terminal_output"; terminalId: string; data: string } | { type: "terminal_exit"; terminalId: string; reason?: string }) => void;
};

export function useAgentSocket(agentId: string, initial: Initial, handlers: Handlers = {}) {
  const [live, setLive] = useState<LiveState>({
    connected: false,
    online: false,
    state: initial.state,
    note: initial.note,
    computerStatus: initial.computerStatus,
    computerMessage: null,
    brains: initial.brains,
    recordingId: null,
    recordingStatus: null,
    recipe: null,
    loginPrompt: null,
    loginResult: null,
    error: null,
    url: "",
  });
  const wsRef = useRef<WebSocket | null>(null);
  const frameRef = useRef<Frame | null>(null);
  const frameListeners = useRef(new Set<(frame: Frame) => void>());
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const listeners = useRef(new Set<Handlers>());

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function each(run: (handlers: Handlers) => void) {
      run(handlersRef.current);
      for (const listener of listeners.current) run(listener);
    }

    function pushFrame(frame: Frame) {
      frameRef.current = frame;
      for (const listener of frameListeners.current) listener(frame);
    }

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/viewer?agent=${encodeURIComponent(agentId)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setLive((s) => ({ ...s, connected: true, error: null }));
      };
      ws.onclose = () => {
        setLive((s) => ({ ...s, connected: false }));
        if (closed) return;
        retry += 1;
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry));
      };
      ws.onmessage = (event) => {
        let message: ServerToViewer;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (message.type) {
          case "snapshot":
            setLive((s) => ({
              ...s,
              online: message.online,
              state: message.state,
              note: message.note ?? null,
              computerStatus: message.computerStatus,
              brains: message.brains,
              recordingId: message.recordingId ?? null,
              recordingStatus: message.recordingId ? "recording" : s.recordingStatus,
              url: message.frame?.url ?? s.url,
            }));
            if (message.frame) pushFrame(message.frame);
            return;
          case "presence":
            setLive((s) => ({
              ...s,
              online: message.online,
              computerStatus: message.computerStatus,
              computerMessage: message.message ?? null,
            }));
            return;
          case "frame":
            pushFrame(message);
            setLive((s) => (s.url === message.url ? s : { ...s, url: message.url }));
            return;
          case "state":
            setLive((s) => ({ ...s, state: message.state, note: message.note ?? null }));
            return;
          case "chat":
            each((h) => h.onChat?.(message.entry));
            return;
          case "recorded":
            each((h) => h.onRecorded?.(message.event, message.seq, message.recordingId));
            return;
          case "recording":
            setLive((s) => ({
              ...s,
              recordingId: message.status === "recording" ? message.recordingId : s.recordingId,
              recordingStatus: message.status,
            }));
            return;
          case "recipe":
            setLive((s) => ({ ...s, recipe: { recipeId: message.recipeId, recordingId: message.recordingId, recipe: message.recipe } }));
            return;
          case "approval":
            each((h) => h.onApproval?.(message.approval));
            return;
          case "approval_closed":
            each((h) => h.onApprovalClosed?.(message.id, message.status));
            return;
          case "run_finished":
            each((h) => h.onRunFinished?.(message.runId, message.ok, message.summary));
            return;
          case "login_prompt":
            setLive((s) => ({ ...s, loginPrompt: message, loginResult: null }));
            return;
          case "login_done":
            setLive((s) => ({ ...s, loginPrompt: null, loginResult: message }));
            return;
          case "chat_delta":
            each((h) => h.onChatDelta?.(message.streamId, message.text));
            return;
          case "jobs":
            each((h) => h.onJobs?.(message.jobs));
            return;
          case "terminal_output":
          case "terminal_exit":
            each((h) => h.onTerminal?.(message));
            return;
          case "files":
            each((h) => h.onFiles?.(message.files));
            return;
          case "credentials":
            each((h) => h.onCredentials?.(message.credentials));
            return;
          case "recipe_failed":
            each((h) => h.onRecipeFailed?.(message.recordingId, message.error));
            return;
          case "run_record":
            return;
          case "memory":
            each((h) => h.onMemory?.(message.files));
            return;
          case "brains":
            setLive((s) => ({ ...s, brains: message.brains }));
            return;
          case "error":
            setLive((s) => ({ ...s, error: message.message }));
            return;
        }
      };
    }

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [agentId]);

  const send = useCallback((message: ViewerToServer) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  const subscribeFrames = useCallback((listener: (frame: Frame) => void) => {
    frameListeners.current.add(listener);
    if (frameRef.current) listener(frameRef.current);
    return () => {
      frameListeners.current.delete(listener);
    };
  }, []);

  const listen = useCallback((handlers: Handlers) => {
    listeners.current.add(handlers);
    return () => {
      listeners.current.delete(handlers);
    };
  }, []);

  return { live, setLive, send, subscribeFrames, listen };
}

export type AgentLink = Pick<ReturnType<typeof useAgentSocket>, "live" | "send" | "listen">;
