import type { WebSocket } from "ws";

export type Frame = { jpegBase64: string; width: number; height: number; url: string; desktop?: boolean };

export type Viewer = { ws: WebSocket; userId: string; owner: boolean };

export type HostConn = { ws: WebSocket; hostId: string; capacity: number; running: Set<string> };

export type Answer = { approved: boolean; note?: string; status: string };

export function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

export function send(ws: WebSocket, message: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}
