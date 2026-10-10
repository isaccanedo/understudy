"use client";

import { useEffect, useRef, useState } from "react";
import { ROOM_SOCKET } from "@/lib/rooms";
import type { RoomEntry, RoomPresence, RoomToServer, ServerToRoom } from "@/server/hub-types";

type Handlers = {
  onEntries: (entries: RoomEntry[]) => void;
  onDelta: (agentId: string, streamId: string, text: string) => void;
  onPresence: (participants: RoomPresence[]) => void;
};

export function useRoomSocket(roomId: string, handlers: Handlers) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}${ROOM_SOCKET}?room=${encodeURIComponent(roomId)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        setError(null);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry += 1;
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry));
      };
      ws.onmessage = (event) => {
        let message: ServerToRoom;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "snapshot") {
          handlersRef.current.onPresence(message.participants);
          handlersRef.current.onEntries(message.recent);
        } else if (message.type === "message") handlersRef.current.onEntries([message.entry]);
        else if (message.type === "delta") handlersRef.current.onDelta(message.agentId, message.streamId, message.text);
        else if (message.type === "presence") handlersRef.current.onPresence([message.participant]);
        else if (message.type === "error") setError(message.message);
      };
    }

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [roomId]);

  function send(message: RoomToServer) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  return { connected, error, send };
}
