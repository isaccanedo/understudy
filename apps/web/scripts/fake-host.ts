import { readFileSync } from "node:fs";
import WebSocket from "ws";
import {
  PATHS,
  PROTOCOL_VERSION,
  type ComputerToServer,
  type JobInfo,
  type Recipe,
  type ServerToComputer,
  type ServerToHost,
} from "@understudy/protocol";

const server = process.env.UNDERSTUDY_SERVER_URL ?? "http://localhost:3100";
const hostToken = process.env.UNDERSTUDY_HOST_TOKEN ?? "dev-host-token";
const framePath = process.env.FAKE_FRAME_JPEG;
const frameBase64 = framePath ? readFileSync(framePath).toString("base64") : "";
const wsBase = server.replace(/^http/, "ws");

function log(...args: unknown[]) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

async function callTool(token: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${server}${PATHS.gatekeeperMcp}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.text();
  const data = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)))
    .find((m) => m.id === 1);
  return data?.result?.content?.[0]?.text ?? body;
}

function startComputer(agentId: string, token: string) {
  let viewers = 0;
  let frameTimer: NodeJS.Timeout | null = null;
  const ws = new WebSocket(`${wsBase}${PATHS.computerSocket}?agent=${agentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const send = (message: ComputerToServer) => ws.send(JSON.stringify(message));
  let url = "https://example.com/";
  const memory = new Map<string, string>([
    ["profile.md", "# Profile\nI issue shipping invoices for my owner."],
    ["journal/2026-10-07.md", "- test run: invoice issued"],
  ]);
  const files = new Map<string, Buffer>([["report.csv", Buffer.from("order,boxes\n118,3\n")]]);
  const inbox = new Map<string, Buffer>();
  const credentials = new Map<string, { name: string; username: string; site?: string }>();
  const sendFiles = () =>
    send({ type: "files", files: [...files].map(([path, data]) => ({ path, size: data.length, updatedAt: Date.now() })) });
  const sendCredentials = () => send({ type: "credentials", credentials: [...credentials.values()] });
  const jobs: JobInfo[] = [
    { id: "job_archive", name: "Rebuild the invoice archive", command: "python rebuild_archive.py --all", status: "running", startedAt: Date.now() - 600_000 },
    { id: "job_export", name: "Export March orders", command: "node export.js --month 03", status: "done", startedAt: Date.now() - 7_200_000, finishedAt: Date.now() - 6_900_000, exitCode: 0 },
  ];
  const sendJobs = () => send({ type: "jobs", jobs: jobs.map((job) => ({ ...job })) });
  const sendMemory = () =>
    send({ type: "memory", files: [...memory].map(([path, text]) => ({ path, text, updatedAt: Date.now() })) });

  ws.on("open", () => {
    log("computer up", agentId);
    send({ type: "hello", agentId, version: PROTOCOL_VERSION, brains: [{ brain: "claude", loggedIn: false }] });
    send({ type: "state", state: "calm" });
    sendMemory();
    sendFiles();
    sendCredentials();
    sendJobs();
  });
  ws.on("unexpected-response", (_, res) => log("computer refused", res.statusCode));
  ws.on("error", (error) => log("computer error", error.message));
  ws.on("close", () => {
    log("computer closed", agentId);
    if (frameTimer) clearInterval(frameTimer);
  });
  ws.on("message", async (raw) => {
    const message = JSON.parse(raw.toString()) as ServerToComputer;
    if (message.type !== "ping" && message.type !== "input") log("computer <-", message.type);
    switch (message.type) {
      case "ping":
        send({ type: "pong", at: message.at });
        return;
      case "viewers":
        viewers = message.count;
        if (viewers > 0 && !frameTimer && frameBase64) {
          frameTimer = setInterval(() => send({ type: "frame", jpegBase64: frameBase64, width: 1280, height: 800, url }), 1000);
        }
        if (viewers === 0 && frameTimer) {
          clearInterval(frameTimer);
          frameTimer = null;
        }
        return;
      case "input":
        if (message.event.kind === "navigate") url = message.event.url;
        if (message.event.kind === "mouse" && message.event.action === "down") log("click at", message.event.x, message.event.y);
        return;
      case "chat":
        send({ type: "state", state: "thinking" });
        {
          const reply = `Got it: "${message.text}". I'll open the page, check what changed and come back with a **short summary** in a minute.`;
          const words = reply.split(" ");
          const streamId = `st_${Math.random().toString(36).slice(2, 10)}`;
          words.forEach((_, i) => {
            setTimeout(() => send({ type: "chat_delta", streamId, text: words.slice(0, i + 1).join(" ") }), 600 + i * 150);
          });
          setTimeout(() => {
            send({ type: "chat", role: "understudy", text: reply, streamId });
            send({ type: "state", state: "calm" });
          }, 600 + words.length * 150 + 300);
        }
        return;
      case "login_start":
        send({ type: "login_prompt", brain: message.brain, url: "https://claude.ai/oauth/device", code: "K7QF-2MXP", message: "Sign in with your account and type the code." });
        setTimeout(() => send({ type: "login_done", brain: message.brain, ok: true, account: "dono@example.com" }), 4000);
        return;
      case "record_start": {
        send({ type: "state", state: "listening" });
        const id = message.recordingId;
        const events = [
          { kind: "navigate", at: Date.now(), url: "https://invoices.example.com/new", title: "New invoice" },
          { kind: "click", at: Date.now(), url, selector: "#cnpj", label: "Customer tax id", x: 200, y: 240 },
          { kind: "input", at: Date.now(), url, selector: "#cnpj", label: "Customer tax id", value: "12.345.678/0001-90", masked: false },
          { kind: "input", at: Date.now(), url, selector: "#senha", label: "Password", value: "••••", masked: true },
          { kind: "select", at: Date.now(), url, selector: "#servico", label: "Service code", value: "08.02" },
        ] as const;
        events.forEach((event, i) => setTimeout(() => send({ type: "recorded", recordingId: id, event: { ...event } }), 800 * (i + 1)));
        return;
      }
      case "record_narration":
        send({ type: "recorded", recordingId: message.recordingId, event: { kind: "narration", at: Date.now(), text: message.text } });
        return;
      case "record_stop": {
        send({ type: "state", state: "thinking" });
        const recipe: Recipe = {
          title: "Issue shipping invoice",
          trigger: "When the carrier sends the box count",
          askFirstRuns: 10,
          steps: [
            { id: "s1", text: "Open the invoice portal", detail: "login saved on my computer", mode: "auto" },
            { id: "s2", text: "Fill in the invoice with service code 08.02", mode: "auto" },
            { id: "s3", text: "Click Issue invoice", detail: "cannot be undone", mode: "ask" },
          ],
          questions: [{ id: "q1", text: "Is the service code always 08.02?", options: ["Always 08.02", "It changes, I will explain"] }],
        };
        setTimeout(() => {
          send({ type: "recipe", recordingId: message.recordingId, recipe });
          send({ type: "state", state: "calm" });
        }, 2500);
        return;
      }
      case "run_recipe": {
        send({ type: "state", state: "working", note: message.recipe.title });
        send({ type: "activity", runId: message.runId, text: "Opening the portal" });
        await callTool(token, "notify_owner", { text: `Starting ${message.recipe.title}` });
        const answer = await callTool(token, "request_approval", {
          runId: message.runId,
          stepId: "s3",
          summary: "May I issue this invoice?",
          fields: [
            { label: "Customer", value: "Example School Ltd" },
            { label: "Amount", value: "$ 18,450.00" },
          ],
        });
        let result = answer;
        while (result.includes('"pending"')) {
          result = await callTool(token, "wait_for_approval", { requestId: JSON.parse(result).requestId });
        }
        log("approval answer", result);
        const approved = result.startsWith("approved");
        send({
          type: "run_record",
          runId: message.runId,
          steps: [
            { at: Date.now() - 5000, text: "Opened the invoice portal", screenshotJpegBase64: frameBase64 || undefined },
            { at: Date.now() - 3000, text: "Filled in the invoice for order 118" },
            { at: Date.now(), text: approved ? "Issued the invoice" : "Stopped before issuing" },
          ],
          unusual: ["The portal asked for a new captcha this time"],
        });
        send({ type: "run_finished", runId: message.runId, ok: approved, summary: approved ? "Invoice issued" : "You did not approve, I stopped before issuing", usage: { inputTokens: 12000, outputTokens: 900, costUsd: 0.07 } });
        return;
      }
      case "file_put":
        inbox.set(message.path, Buffer.from(message.base64, "base64"));
        log("inbox got", message.path);
        return;
      case "file_get": {
        const data = files.get(message.path);
        send({ type: "file_content", requestId: message.requestId, path: message.path, base64: data?.toString("base64"), error: data ? undefined : "not_found" });
        return;
      }
      case "credential_set":
        credentials.set(message.name, { name: message.name, username: message.username, site: message.site });
        log("credential set", message.name, "secret length", message.secret.length);
        sendCredentials();
        return;
      case "credential_delete":
        credentials.delete(message.name);
        sendCredentials();
        return;
      case "teach_text":
        setTimeout(() => {
          send({
            type: "recipe",
            recordingId: message.recordingId,
            recipe: {
              title: "Described task",
              trigger: "When you ask",
              askFirstRuns: 3,
              steps: message.text.split(/[.\n]+/).map((t, i) => t.trim()).filter(Boolean).map((t, i) => ({ id: `d${i}`, text: t, mode: "auto" as const })),
              questions: [],
            },
          });
        }, 1500);
        return;
      case "terminal_open":
        send({ type: "terminal_output", terminalId: message.terminalId, data: "agent@computer:~$ " });
        return;
      case "terminal_input":
        send({ type: "terminal_output", terminalId: message.terminalId, data: message.data === "\r" ? "\r\nagent@computer:~$ " : message.data });
        return;
      case "job_stop": {
        const job = jobs.find((j) => j.id === message.jobId);
        if (job) Object.assign(job, { status: "stopped", finishedAt: Date.now(), exitCode: 143 });
        sendJobs();
        return;
      }
      case "memory_write":
        memory.set(message.path, message.text);
        sendMemory();
        return;
      case "memory_delete":
        memory.delete(message.path);
        sendMemory();
        return;
      case "approval_answer":
      case "set_brain":
      case "stop":
        return;
    }
  });
}

function startHost() {
  const ws = new WebSocket(`${wsBase}${PATHS.hostSocket}`, { headers: { Authorization: `Bearer ${hostToken}` } });
  ws.on("open", () => {
    log("host up");
    ws.send(JSON.stringify({ type: "host_hello", hostId: "fake-host", capacity: 10, running: [] }));
  });
  ws.on("unexpected-response", (_, res) => log("host refused", res.statusCode));
  ws.on("error", (error) => log("host error", error.message));
  ws.on("close", () => {
    log("host closed, retrying");
    setTimeout(startHost, 2000);
  });
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as ServerToHost;
    log("host <-", message.type);
    if (message.type === "computer_ensure") {
      ws.send(JSON.stringify({ type: "computer_status", agentId: message.spec.agentId, status: "starting" }));
      setTimeout(() => {
        startComputer(message.spec.agentId, message.spec.token);
        ws.send(JSON.stringify({ type: "computer_status", agentId: message.spec.agentId, status: "running" }));
      }, 1000);
    }
  });
}

startHost();
