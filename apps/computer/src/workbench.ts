import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { log } from "@understudy/runtime";

export const BENCH_SOCKET = process.env.UNDERSTUDY_BENCH_SOCKET || "/run/bench/shell.sock";
export const FILES_ROOT = process.env.UNDERSTUDY_FILES_ROOT || "/home/agent/files";
export const OUTPUT_LIMIT = 100 * 1024;

export type BenchRequest =
  | { op: "exec"; id: string; command: string; cwd?: string; timeoutMs?: number }
  | { op: "term_open"; id: string; cols: number; rows: number }
  | { op: "term_input"; id: string; data: string }
  | { op: "term_resize"; id: string; cols: number; rows: number }
  | { op: "term_close"; id: string }
  | { op: "job_start"; id: string; command: string; name?: string; cwd?: string }
  | { op: "job_output"; id: string; jobId: string; tailBytes?: number }
  | { op: "job_stop"; id?: string; jobId: string }
  | { op: "job_list"; id: string };

export type JobInfo = { id: string; name: string; command: string; status: "running" | "done" | "failed" | "stopped"; startedAt: number; finishedAt?: number; exitCode?: number | null };

export type BenchEvent =
  | { op: "exec_result"; id: string; stdout: string; stderr: string; code: number | null; timedOut: boolean; truncated: boolean }
  | { op: "term_output"; id: string; data: string }
  | { op: "term_exit"; id: string; reason?: string }
  | { op: "job_started"; id: string; job?: JobInfo; error?: string }
  | { op: "job_output_result"; id: string; jobId: string; output: string; job?: JobInfo }
  | { op: "jobs"; id?: string; jobs: JobInfo[] };

export const MAX_RUNNING_JOBS = 8;
export const MAX_KEPT_JOBS = 50;
export const JOB_OUTPUT_KEEP = 256 * 1024;

export function insideFiles(root: string, requested: string | undefined): string {
  const base = resolve(root);
  if (!requested) return base;
  const target = resolve(base, requested);
  return target === base || target.startsWith(base + sep) ? target : base;
}

export function decodeTmuxOutput(text: string): string {
  return text.replace(/\\([0-7]{3})|\\\\/g, (_whole, octal) => (octal ? String.fromCharCode(parseInt(octal, 8)) : "\\"));
}

export function encodeKeys(data: string): string {
  return Buffer.from(data, "utf8").toString("hex").match(/../g)?.join(" ") ?? "";
}

export function clampSize(value: unknown, min: number, max: number, fallback: number): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function benchEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: `${home}/.local/bin:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`,
    HOME: home,
    LANG: "C.UTF-8",
    TERM: "xterm-256color",
    NPM_CONFIG_PREFIX: `${home}/.local`,
    PIP_USER: "1",
    PIP_BREAK_SYSTEM_PACKAGES: "1",
    ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
  };
}

function runCommand(request: Extract<BenchRequest, { op: "exec" }>, reply: (event: BenchEvent) => void) {
  const timeoutMs = Math.max(1000, Math.min(10 * 60 * 1000, request.timeoutMs ?? 120000));
  const child = spawn("bash", ["-lc", request.command], { cwd: insideFiles(FILES_ROOT, request.cwd), env: benchEnv(FILES_ROOT) });
  let stdout = "";
  let stderr = "";
  let truncated = false;
  let timedOut = false;
  const collect = (current: string, chunk: Buffer) => {
    if (current.length >= OUTPUT_LIMIT) {
      truncated = true;
      return current;
    }
    const next = current + chunk.toString("utf8");
    if (next.length > OUTPUT_LIMIT) truncated = true;
    return next.slice(0, OUTPUT_LIMIT);
  };
  child.stdout.on("data", (chunk: Buffer) => (stdout = collect(stdout, chunk)));
  child.stderr.on("data", (chunk: Buffer) => (stderr = collect(stderr, chunk)));
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  child.on("close", (code) => {
    clearTimeout(timer);
    reply({ op: "exec_result", id: request.id, stdout, stderr, code, timedOut, truncated });
  });
  child.on("error", (error) => {
    clearTimeout(timer);
    reply({ op: "exec_result", id: request.id, stdout, stderr: error.message, code: null, timedOut, truncated });
  });
}

type Job = JobInfo & { child: ChildProcessWithoutNullStreams | null; output: string };

export class Jobs {
  private jobs = new Map<string, Job>();
  private sequence = 0;
  private onChange: () => void;
  private root: string;

  constructor(onChange: () => void, root = FILES_ROOT) {
    this.onChange = onChange;
    this.root = root;
  }

  list(): JobInfo[] {
    return [...this.jobs.values()].map(({ child: _child, output: _output, ...info }) => info);
  }

  start(command: string, name?: string, cwd?: string): JobInfo | string {
    const running = [...this.jobs.values()].filter((job) => job.status === "running").length;
    if (running >= MAX_RUNNING_JOBS) return `at most ${MAX_RUNNING_JOBS} jobs can run at once; stop one first`;
    this.sequence += 1;
    const id = `job-${this.sequence}`;
    const child = spawn("bash", ["-lc", command], { cwd: insideFiles(this.root, cwd), env: benchEnv(this.root), detached: true });
    const job: Job = { id, name: (name || command).replace(/\s+/g, " ").slice(0, 80), command: command.slice(0, 2000), status: "running", startedAt: Date.now(), child, output: "" };
    const collect = (chunk: Buffer) => {
      job.output = (job.output + chunk.toString("utf8")).slice(-JOB_OUTPUT_KEEP);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("close", (code) => {
      if (job.status === "running") job.status = code === 0 ? "done" : "failed";
      job.exitCode = code;
      job.finishedAt = Date.now();
      job.child = null;
      this.onChange();
    });
    child.on("error", (error) => collect(Buffer.from(`\n${error.message}\n`)));
    this.jobs.set(id, job);
    this.prune();
    this.onChange();
    return this.list().find((info) => info.id === id) as JobInfo;
  }

  output(jobId: string, tailBytes = 16 * 1024): { output: string; job?: JobInfo } {
    const job = this.jobs.get(jobId);
    if (!job) return { output: "" };
    return { output: job.output.slice(-Math.max(1, Math.min(JOB_OUTPUT_KEEP, tailBytes))), job: this.list().find((info) => info.id === jobId) };
  }

  stop(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job?.child || job.status !== "running") return false;
    job.status = "stopped";
    try {
      process.kill(-(job.child.pid ?? 0), "SIGTERM");
    } catch {
      job.child.kill("SIGTERM");
    }
    const child = job.child;
    setTimeout(() => {
      try {
        process.kill(-(child.pid ?? 0), "SIGKILL");
      } catch {}
    }, 5000).unref();
    this.onChange();
    return true;
  }

  private prune() {
    const finished = [...this.jobs.values()].filter((job) => job.status !== "running");
    for (const job of finished.slice(0, Math.max(0, this.jobs.size - MAX_KEPT_JOBS))) this.jobs.delete(job.id);
  }
}

export const TERMINAL_IDLE_MS = 2 * 60 * 60 * 1000;

export class Terminal {
  private control: ChildProcessWithoutNullStreams;
  private session: string;
  private emit: (event: BenchEvent) => void;
  private detached = false;
  private block: string[] | null = null;
  private awaitingCapture: boolean;
  lastActive = Date.now();
  readonly id: string;

  constructor(id: string, cols: number, rows: number, emit: (event: BenchEvent) => void, reattach = false) {
    this.id = id;
    this.emit = emit;
    this.awaitingCapture = reattach;
    this.session = `term-${id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;
    this.control = spawn(
      "tmux",
      ["-L", "bench", "-C", "new-session", "-A", "-s", this.session, "-x", String(cols), "-y", String(rows), "-c", FILES_ROOT, "bash", "-l"],
      { cwd: FILES_ROOT, env: benchEnv(FILES_ROOT) },
    );
    createInterface({ input: this.control.stdout }).on("line", (line) => this.line(line));
    this.control.on("close", () => {
      if (!this.detached) this.emit({ op: "term_exit", id: this.id });
    });
    this.control.on("error", (error) => {
      if (!this.detached) this.emit({ op: "term_exit", id: this.id, reason: error.message });
    });
    if (reattach) {
      this.control.stdin.write(`refresh-client -C ${cols}x${rows}\n`);
      this.control.stdin.write(`capture-pane -p -e -J -t ${this.session}\n`);
    }
  }

  private line(line: string) {
    if (this.block) {
      if (line.startsWith("%end") || line.startsWith("%error")) {
        const captured = this.block;
        this.block = null;
        if (this.awaitingCapture && captured.some((row) => row.trim())) {
          this.awaitingCapture = false;
          this.emit({ op: "term_output", id: this.id, data: `\x1b[2J\x1b[H${captured.join("\r\n")}` });
        }
        return;
      }
      this.block.push(line);
      return;
    }
    if (line.startsWith("%begin")) {
      this.block = [];
      return;
    }
    if (line.startsWith("%output ")) {
      const space = line.indexOf(" ", 8);
      if (space > 0 && !this.detached) this.emit({ op: "term_output", id: this.id, data: decodeTmuxOutput(line.slice(space + 1)) });
    } else if (line.startsWith("%exit") && !this.detached) {
      this.emit({ op: "term_exit", id: this.id, reason: line.slice(5).trim() || undefined });
    }
  }

  input(data: string) {
    this.lastActive = Date.now();
    const keys = encodeKeys(data.slice(0, 64 * 1024));
    if (keys) this.control.stdin.write(`send-keys -t ${this.session} -H ${keys}\n`);
  }

  resize(cols: number, rows: number) {
    this.control.stdin.write(`refresh-client -C ${cols}x${rows}\n`);
  }

  detach() {
    this.detached = true;
    this.control.kill();
  }

  close() {
    this.control.stdin.write(`kill-session -t ${this.session}\n`);
    setTimeout(() => this.control.kill(), 500).unref();
  }
}

export function serve(socketPath = BENCH_SOCKET) {
  mkdirSync(dirname(socketPath), { recursive: true });
  rmSync(socketPath, { force: true });
  mkdirSync(FILES_ROOT, { recursive: true });
  const terminals = new Map<string, Terminal>();
  const sockets = new Set<Socket>();
  const jobs = new Jobs(() => {
    const line = `${JSON.stringify({ op: "jobs", jobs: jobs.list() } satisfies BenchEvent)}\n`;
    for (const socket of sockets) if (!socket.destroyed) socket.write(line);
  });
  const server = createServer((socket: Socket) => {
    const owned = new Set<string>();
    sockets.add(socket);
    const reply = (event: BenchEvent) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(event)}\n`);
    };
    reply({ op: "jobs", jobs: jobs.list() });
    createInterface({ input: socket }).on("line", (line) => {
      let request: BenchRequest;
      try {
        request = JSON.parse(line);
      } catch {
        return;
      }
      if (request.op === "exec" && typeof request.command === "string") return runCommand(request, reply);
      if (request.op === "job_start" && typeof request.command === "string") {
        const started = jobs.start(request.command, typeof request.name === "string" ? request.name : undefined, typeof request.cwd === "string" ? request.cwd : undefined);
        return reply(typeof started === "string" ? { op: "job_started", id: request.id, error: started } : { op: "job_started", id: request.id, job: started });
      }
      if (request.op === "job_output" && typeof request.jobId === "string") return reply({ op: "job_output_result", id: request.id, jobId: request.jobId, ...jobs.output(request.jobId, Number(request.tailBytes) || undefined) });
      if (request.op === "job_stop" && typeof request.jobId === "string") {
        jobs.stop(request.jobId);
        return reply({ op: "jobs", id: request.id, jobs: jobs.list() });
      }
      if (request.op === "job_list") return reply({ op: "jobs", id: request.id, jobs: jobs.list() });
      if (request.op === "term_open") {
        const previous = terminals.get(request.id);
        previous?.detach();
        const terminal: Terminal = new Terminal(
          request.id,
          clampSize(request.cols, 20, 400, 120),
          clampSize(request.rows, 5, 200, 30),
          (event) => {
            reply(event);
            if (event.op === "term_exit" && terminals.get(request.id) === terminal) {
              terminals.delete(request.id);
              owned.delete(request.id);
            }
          },
          Boolean(previous),
        );
        terminals.set(request.id, terminal);
        owned.add(request.id);
        return;
      }
      const terminal = terminals.get(request.id);
      if (!terminal) return;
      if (request.op === "term_input" && typeof request.data === "string") terminal.input(request.data);
      if (request.op === "term_resize") terminal.resize(clampSize(request.cols, 20, 400, 120), clampSize(request.rows, 5, 200, 30));
      if (request.op === "term_close") terminal.close();
    });
    socket.on("close", () => {
      sockets.delete(socket);
      for (const id of owned) terminals.get(id)?.close();
    });
    socket.on("error", () => {});
  });
  const idleSweep = setInterval(() => {
    const now = Date.now();
    for (const [id, terminal] of terminals) {
      if (now - terminal.lastActive < TERMINAL_IDLE_MS) continue;
      log("bench", `closing terminal ${id} after ${Math.round(TERMINAL_IDLE_MS / 60000)} idle minutes`);
      terminals.delete(id);
      terminal.close();
    }
  }, 60 * 1000);
  idleSweep.unref();
  server.listen(socketPath, () => {
    chmodSync(socketPath, 0o600);
    log("bench", `listening on ${socketPath}, files at ${FILES_ROOT}`);
  });
  return server;
}

export function workbenchEnv(home: string, display?: string): NodeJS.ProcessEnv {
  return { ...benchEnv(home), UNDERSTUDY_FILES_ROOT: home, ...(display ? { DISPLAY: display } : {}) };
}

export function startLocalWorkbench(home: string, display?: string): { stop: () => void } {
  let stopped = false;
  let child: ReturnType<typeof spawn> | null = null;
  const launch = () => {
    if (stopped) return;
    child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", new URL(import.meta.url).pathname], {
      cwd: home,
      env: workbenchEnv(home, display),
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("exit", (code) => {
      child = null;
      if (stopped) return;
      log("bench", `shell host exited with ${code}, starting it again`);
      setTimeout(launch, 1000).unref();
    });
  };
  launch();
  return {
    stop: () => {
      stopped = true;
      child?.kill();
    },
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  serve();
}
