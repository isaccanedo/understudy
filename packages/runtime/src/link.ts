import WebSocket from "ws";
import { log } from "./log.ts";

export type LinkOptions<In> = {
  url: string;
  token: string;
  parse: (raw: unknown) => { ok: true; message: In } | { ok: false; error: string };
  onOpen: () => void;
  onMessage: (message: In) => void;
  onClose?: () => void;
};

export type Link<Out> = {
  send: (message: Out) => boolean;
  isOpen: () => boolean;
  pressure: () => number;
  close: () => void;
};

const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const IDLE_TIMEOUT_MS = 75000;
const HEARTBEAT_MS = 25000;

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export function openLink<In, Out>(options: LinkOptions<In>): Link<Out> {
  let socket: WebSocket | null = null;
  let attempt = 0;
  let closed = false;
  let idleTimer: NodeJS.Timeout | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      log("link", "no traffic from server, reconnecting");
      socket?.terminate();
    }, IDLE_TIMEOUT_MS);
  };

  const connect = () => {
    if (closed) return;
    const current = new WebSocket(options.url, {
      headers: { Authorization: `Bearer ${options.token}` },
      maxPayload: 32 * 1024 * 1024,
    });
    socket = current;

    current.on("open", () => {
      attempt = 0;
      log("link", `connected to ${redact(options.url)}`);
      touch();
      heartbeat = setInterval(() => current.ping(), HEARTBEAT_MS);
      options.onOpen();
    });

    current.on("message", (data) => {
      touch();
      const parsed = options.parse(data.toString());
      if (!parsed.ok) {
        log("link", `dropped an invalid message: ${parsed.error}`);
        return;
      }
      try {
        options.onMessage(parsed.message);
      } catch (error) {
        log("link", `handler failed: ${(error as Error).message}`);
      }
    });

    current.on("ping", touch);
    current.on("pong", touch);

    current.on("unexpected-response", (_request, response) => {
      log("link", `server refused the socket with HTTP ${response.statusCode}`);
      current.terminate();
    });

    current.on("error", (error) => {
      log("link", `socket error: ${error.message}`);
    });

    current.on("close", () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (heartbeat) clearInterval(heartbeat);
      if (socket === current) socket = null;
      options.onClose?.();
      if (closed) return;
      const delay = backoffDelay(attempt++);
      log("link", `disconnected, retrying in ${delay}ms`);
      retryTimer = setTimeout(connect, delay);
    });
  };

  connect();

  return {
    send(message) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    isOpen() {
      return !!socket && socket.readyState === WebSocket.OPEN;
    },
    pressure() {
      return socket?.bufferedAmount ?? 0;
    },
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (idleTimer) clearTimeout(idleTimer);
      socket?.close();
    },
  };
}

function redact(url: string): string {
  return url.replace(/token=[^&]+/, "token=***");
}
