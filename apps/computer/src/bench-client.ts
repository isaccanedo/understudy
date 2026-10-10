import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { BENCH_SOCKET, type BenchEvent, type BenchRequest } from "./workbench.ts";

export type ExecResult = Extract<BenchEvent, { op: "exec_result" }>;

export type BenchClient = {
  exec: (command: string, options?: { cwd?: string; timeoutMs?: number }) => Promise<ExecResult>;
  call: (request: BenchRequest & { id: string }) => Promise<BenchEvent>;
  send: (request: BenchRequest) => boolean;
  close: () => void;
};

export function connectBench(onEvent: (event: BenchEvent) => void = () => {}, socketPath = BENCH_SOCKET): BenchClient {
  let socket: Socket | null = null;
  const pending = new Map<string, (result: ExecResult) => void>();
  const calls = new Map<string, (event: BenchEvent) => void>();

  const open = () => {
    if (socket && !socket.destroyed) return socket;
    const current = createConnection(socketPath);
    socket = current;
    const lines = createInterface({ input: current });
    lines.on("error", () => {});
    lines.on("line", (line) => {
      let event: BenchEvent;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      const callId = "id" in event ? event.id : undefined;
      if (event.op !== "exec_result" && callId && calls.has(callId)) {
        calls.get(callId)?.(event);
        calls.delete(callId);
        return;
      }
      if (event.op === "exec_result") {
        pending.get(event.id)?.(event);
        pending.delete(event.id);
        return;
      }
      onEvent(event);
    });
    const fail = (reason: string) => {
      for (const [id, resolve] of pending) resolve({ op: "exec_result", id, stdout: "", stderr: reason, code: null, timedOut: false, truncated: false });
      pending.clear();
      for (const [, resolve] of calls) resolve({ op: "job_started", id: "", error: reason });
      calls.clear();
      if (socket === current) socket = null;
    };
    current.on("error", (error) => fail(`the workbench is not reachable: ${error.message}`));
    current.on("close", () => fail("the workbench closed the connection"));
    return current;
  };

  return {
    exec(command, options = {}) {
      const id = randomUUID();
      return new Promise<ExecResult>((resolve) => {
        pending.set(id, resolve);
        open().write(`${JSON.stringify({ op: "exec", id, command, ...options })}\n`);
      });
    },
    call(request) {
      return new Promise<BenchEvent>((resolve) => {
        calls.set(request.id, resolve);
        open().write(`${JSON.stringify(request)}\n`);
      });
    },
    send(request) {
      try {
        open().write(`${JSON.stringify(request)}\n`);
        return true;
      } catch {
        return false;
      }
    },
    close() {
      socket?.end();
      socket = null;
    },
  };
}
