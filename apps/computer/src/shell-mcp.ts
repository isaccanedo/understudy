import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { connectBench, type BenchClient, type ExecResult } from "./bench-client.ts";
import type { BenchEvent, JobInfo } from "./workbench.ts";

export const SHELL_TOOLS = [
  {
    name: "run_command",
    description:
      "Run a shell command (bash) on your computer, the same one your browser runs on. It starts in your home folder; your files are in ~/files. It has common tools (git, curl, node, python). Graphical programs you start open on your screen, where your owner can see them. Long output is cut at 100 KB.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string", description: "Folder inside your files folder, relative to it. Default: the files folder." },
        timeoutSeconds: { type: "number", description: "Default 120, at most 600." },
      },
      required: ["command"],
    },
  },
  {
    name: "start_job",
    description:
      "Start a long command in the background on your computer (a build, a big conversion, a download, a script that takes minutes) and get a job id back at once. Your owner sees your jobs in the panel. Check it later with job_output; stop it with stop_job. At most 8 run at once.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        name: { type: "string", description: "A short name your owner will understand, like \"Converting the March invoices\"." },
        cwd: { type: "string", description: "Folder inside your files folder, relative to it." },
      },
      required: ["command"],
    },
  },
  { name: "list_jobs", description: "List your background jobs with their status.", inputSchema: { type: "object", properties: {} } },
  {
    name: "job_output",
    description: "Read the latest output of a background job and its status.",
    inputSchema: { type: "object", properties: { jobId: { type: "string" }, tailBytes: { type: "number", description: "Default 16000." } }, required: ["jobId"] },
  },
  { name: "stop_job", description: "Stop a running background job.", inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] } },
];

export function describeJob(job: JobInfo): string {
  const ended = job.finishedAt ? `, ended ${new Date(job.finishedAt).toISOString()}` : "";
  const exit = job.exitCode === undefined ? "" : `, exit code ${job.exitCode === null ? "none" : job.exitCode}`;
  return `${job.id} [${job.status}] "${job.name}" started ${new Date(job.startedAt).toISOString()}${ended}${exit}`;
}

export async function callJobTool(bench: BenchClient, name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const id = randomUUID();
  let event: BenchEvent;
  if (name === "start_job") event = await bench.call({ op: "job_start", id, command: String(args.command ?? ""), ...(args.name ? { name: String(args.name) } : {}), ...(args.cwd ? { cwd: String(args.cwd) } : {}) });
  else if (name === "list_jobs") event = await bench.call({ op: "job_list", id });
  else if (name === "job_output") event = await bench.call({ op: "job_output", id, jobId: String(args.jobId ?? ""), ...(args.tailBytes ? { tailBytes: Number(args.tailBytes) } : {}) });
  else event = await bench.call({ op: "job_stop", id, jobId: String(args.jobId ?? "") });
  if (event.op === "job_started") return event.job ? { text: `started ${describeJob(event.job)}` } : { text: event.error ?? "could not start the job", isError: true };
  if (event.op === "job_output_result") return event.job ? { text: `${describeJob(event.job)}\noutput:\n${event.output}` } : { text: `no job ${event.jobId}`, isError: true };
  if (event.op === "jobs") return { text: event.jobs.length ? event.jobs.map(describeJob).join("\n") : "no jobs" };
  return { text: "unexpected answer from the shell", isError: true };
}

export function formatResult(result: ExecResult): string {
  const parts = [`exit code: ${result.code === null ? "none" : result.code}${result.timedOut ? " (timed out)" : ""}${result.truncated ? " (output cut)" : ""}`];
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  return parts.join("\n");
}

async function serve() {
  const bench = connectBench();
  const reply = (id: unknown, result: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  for await (const line of createInterface({ input: process.stdin })) {
    let message: { id?: unknown; method?: string; params?: any };
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined) continue;
    if (message.method === "initialize") reply(message.id, { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "understudy-shell", version: "1" } });
    else if (message.method === "tools/list") reply(message.id, { tools: SHELL_TOOLS });
    else if (message.method === "ping") reply(message.id, {});
    else if (message.method === "tools/call" && message.params?.name === "run_command") {
      const args = message.params.arguments ?? {};
      const result = await bench.exec(String(args.command ?? ""), {
        ...(args.cwd ? { cwd: String(args.cwd) } : {}),
        timeoutMs: Math.min(600, Math.max(1, Number(args.timeoutSeconds) || 120)) * 1000,
      });
      reply(message.id, { content: [{ type: "text", text: formatResult(result) }], ...(result.code === 0 ? {} : { isError: true }) });
    } else if (message.method === "tools/call" && ["start_job", "list_jobs", "job_output", "stop_job"].includes(message.params?.name)) {
      const result = await callJobTool(bench, message.params.name, message.params.arguments ?? {});
      reply(message.id, { content: [{ type: "text", text: result.text }], ...(result.isError ? { isError: true } : {}) });
    } else {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } })}\n`);
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  void serve();
}
