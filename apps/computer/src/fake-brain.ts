import type { Recipe } from "@understudy/protocol";
import type { BrainConfig, BrainEvent, Turn, TurnRequest, TurnResult } from "./brain.ts";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { openGatekeeper } from "./gatekeeper-client.ts";
import { connectBench } from "./bench-client.ts";
import { createInterface } from "node:readline";

export const SPREADSHEET_SCRIPT = `from openpyxl import Workbook
from openpyxl.styles import Font
book = Workbook()
sheet = book.active
sheet.title = "Invoices"
sheet.append(["Supplier", "Invoice", "Amount (USD)", "Due"])
for row in [["Acme Supplies", "INV-2041", 1240.00, "2026-10-10"], ["Blue Harbor Logistics", "INV-7783", 860.50, "2026-10-12"], ["Greenleaf Paper Co.", "INV-0312", 312.00, "2026-10-14"]]:
    sheet.append(row)
sheet.append(["Total", "", 2412.50, ""])
for cell in sheet[1]:
    cell.font = Font(bold=True)
for column, width in zip("ABCD", [26, 14, 16, 14]):
    sheet.column_dimensions[column].width = width
book.save("outbox/NAME.xlsx")
print("saved outbox/NAME.xlsx")`;

export function fakeBrainEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.UNDERSTUDY_FAKE_BRAIN === "1";
}

export function fakeRecipe(prompt: string): Recipe {
  const steps: Recipe["steps"] = [];
  const add = (text: string, detail: string, mode: "auto" | "ask" = "auto") => steps.push({ id: `s${steps.length + 1}`, text, detail, mode });
  for (const line of prompt.split("\n")) {
    const navigate = line.match(/ NAVIGATE (\S+)/);
    const click = line.match(/ CLICK "([^"]*)" selector=(.+?) at \S+$/) ?? line.match(/ CLICK "([^"]*)"()/);
    const typed = line.match(/ TYPE into "([^"]*)" selector=(.+?) value=(".*"|\[MASKED SECRET\])$/) ?? line.match(/ TYPE into "([^"]*)"()()/);
    const selected = line.match(/ SELECT "([^"]*)" in "([^"]*)"/);
    if (navigate && !steps.some((step) => step.detail === navigate[1])) add("Open the page", navigate[1]);
    else if (typed) add(`Fill in ${typed[1]}`, typed[3] && typed[3].startsWith('"') ? `${typed[3]} into ${typed[2]}` : typed[1]);
    else if (selected) add(`Choose ${selected[1]} in ${selected[2]}`, selected[2]);
    else if (click) add(`Click ${click[1]}`, click[2] || click[1], /submit|send|save|enviar|salvar|pay|delete/i.test(click[1]) ? "ask" : "auto");
  }
  if (!steps.some((step) => step.mode === "ask")) add("Submit", "The irreversible step of this task", "ask");
  const named = prompt.match(/ OWNER SAID: "Task: ([^"\\]{1,80})/);
  return { title: named ? named[1].trim() : "Fake recipe", trigger: "when the owner asks", steps: steps.slice(0, 12), questions: [], askFirstRuns: 3 };
}

type PlannedStep = { action: "navigate" | "click" | "type"; text: string; target: string; value?: string };

export function planSteps(prompt: string): PlannedStep[] {
  const plan: PlannedStep[] = [];
  for (const match of prompt.matchAll(/^s\d+\. (.*?)(?: \[ASK FIRST\])?\n\s+how: (.*)$/gm)) {
    const [, text, how] = match;
    if (text === "Open the page") plan.push({ action: "navigate", text, target: how.trim() });
    else if (text.startsWith("Click ")) plan.push({ action: "click", text, target: how.trim() });
    else if (text.startsWith("Fill in ")) {
      const typed = how.trim().match(/^(".*") into (.+)$/);
      if (typed) {
        try {
          plan.push({ action: "type", text, target: typed[2], value: String(JSON.parse(typed[1])) });
        } catch {}
      }
    }
  }
  return plan;
}


type GuardedBrowser = { call: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>; close: () => void };

async function openGuardedBrowser(config: BrainConfig): Promise<GuardedBrowser> {
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", new URL("./browser-guard.ts", import.meta.url).pathname], {
    cwd: config.workDir,
    env: { ...process.env, HOME: config.home, AGENT_TOKEN: config.token, UNDERSTUDY_SERVER_URL: config.serverUrl },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map<number, (message: any) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    } catch {}
  });
  let next = 0;
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<any>((resolve) => {
      const id = ++next;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "understudy-fake-brain", version: "1" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    async call(name, args) {
      const reply = await request("tools/call", { name, arguments: args });
      const text = (reply.result?.content ?? []).map((part: { text?: string }) => part.text ?? "").join("\n") || JSON.stringify(reply.error ?? "");
      return { text, isError: Boolean(reply.result?.isError || reply.error) };
    },
    close: () => child.kill(),
  };
}

export function attachedPaths(prompt: string): { path: string; mime: string }[] {
  const found: { path: string; mime: string }[] = [];
  for (const match of prompt.matchAll(/^- (".*") \(([^,]+), [^)]+\)$/gm)) {
    try {
      found.push({ path: String(JSON.parse(match[1])), mime: match[2] });
    } catch {}
  }
  return found;
}

export function clipCommand(input: string, seconds: number, output: string): string {
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  return `mkdir -p "$(dirname ${quote(output)})" && ffmpeg -y -loglevel error -ss 0 -t ${seconds} -i ${quote(input)} -c:v libx264 -preset ultrafast -pix_fmt yuv420p -movflags +faststart -an ${quote(output)}`;
}

export function fakeRoomReply(prompt: string): string {
  const self = prompt.match(/^You are: (.+)$/m)?.[1]?.trim() ?? "";
  const who = prompt.match(/other understudies:\n((?:- .+\n?)+)/)?.[1] ?? "";
  const others = [...who.matchAll(/^- (.+?)(?: \(.*\))?$/gm)].map((match) => match[1].trim());
  const lines = [...prompt.matchAll(/^\[[^\]]+\] (.+?): (".*")$/gm)].map((match) => {
    let text = "";
    try {
      text = String(JSON.parse(match[2]));
    } catch {}
    return { who: match[1], text };
  });
  const last = [...lines].reverse().find((line) => line.who !== self && line.who !== "room");
  if (!last || /\bpass test\b/i.test(last.text)) return "PASS";
  if (last.who.endsWith("(owner)")) {
    const lead = others.every((name) => self.localeCompare(name) < 0);
    const ask = lead && others.length && /each other|discuss|together|entre voc|conversem/i.test(last.text) ? ` @${others[0]} what do you think?` : "";
    return `${self} here. About "${last.text.slice(0, 80)}": I can take my part of it.${ask}`;
  }
  return `Agreed with ${last.who}. I will take my part.`;
}

export function startFakeTurn(config: BrainConfig, request: TurnRequest): Turn {
  const controller = new AbortController();
  const emit = (event: BrainEvent) => request.onEvent(event);
  const sessionId = request.resume ?? `fake-${Date.now()}`;
  const usage = { inputTokens: 100, outputTokens: 20 };

  const work = async (): Promise<TurnResult> => {
    emit({ kind: "session", sessionId });
    emit({ kind: "thinking" });
    const prompt = request.prompt;
    if (prompt.includes("STRICT JSON")) {
      const text = JSON.stringify(fakeRecipe(prompt));
      return { ok: true, sessionId, text, usage };
    }
    const runId = prompt.match(/^Run id: (\S+)/m)?.[1];
    if (runId) {
      emit({ kind: "text", text: "Starting the run." });
      const browser = await openGuardedBrowser(config);
      try {
        for (const step of planSteps(prompt)) {
          const call =
            step.action === "navigate"
              ? { name: "browser_navigate", args: { url: step.target } }
              : step.action === "type"
                ? { name: "browser_type", args: { element: step.text, target: step.target, text: step.value ?? "" } }
                : { name: "browser_click", args: { element: step.text, target: step.target } };
          emit({ kind: "tool", name: `mcp__browser__${call.name}`, input: call.args });
          const result = await browser.call(call.name, call.args);
          emit({ kind: "tool_result", name: `mcp__browser__${call.name}`, isError: result.isError, text: result.text });
          if (/^blocked/i.test(result.text)) {
            const text = `Stopped at "${step.text}": ${result.text.split("\n")[0]}\nRESULT ${JSON.stringify({ ok: false, summary: `Not approved: ${step.text}`, anomalies: [] })}`;
            emit({ kind: "text", text });
            return { ok: true, sessionId, text, usage };
          }
          if (result.isError) throw new Error(`${call.name} failed: ${result.text.slice(0, 200)}`);
        }
      } finally {
        browser.close();
      }
      const text = `Done.\nRESULT ${JSON.stringify({ ok: true, summary: "Every step is done and checked.", anomalies: [] })}`;
      emit({ kind: "text", text });
      return { ok: true, sessionId, text, usage };
    }
    if (prompt.startsWith("The day is over")) return { ok: true, sessionId, text: "Talked with the owner.", usage };
    if (prompt.includes("GROUP ROOM \"")) {
      const text = fakeRoomReply(prompt);
      emit({ kind: "tool", name: "mcp__gatekeeper__list_teammates", input: {} });
      await new Promise((resolve) => setTimeout(resolve, 900));
      emit({ kind: "text_start" });
      for (const word of text.match(/\S+\s*/g) ?? []) {
        emit({ kind: "text_delta", text: word });
        await new Promise((resolve) => setTimeout(resolve, 70));
      }
      emit({ kind: "text", text });
      return { ok: true, sessionId, text, usage };
    }
    if (prompt.includes("Message from your teammate")) {
      const text = "Thanks, noted.";
      emit({ kind: "text", text });
      return { ok: true, sessionId, text, usage };
    }
    const tell = prompt.match(/^tell (.+?): (.+)$/im);
    const handOff = prompt.match(/^hand off (.+?) to (.+?): (.+)$/im);
    if (tell || handOff) {
      const gatekeeper = await openGatekeeper(config.serverUrl, config.token, controller.signal);
      const call = handOff
        ? { name: "hand_off", args: { agent: handOff[2].trim(), task: handOff[1].trim(), input: handOff[3].trim() } }
        : { name: "message_agent", args: { agent: tell![1].trim(), text: tell![2].trim() } };
      emit({ kind: "tool", name: `mcp__gatekeeper__${call.name}`, input: call.args });
      const answer = await gatekeeper.call(call.name, call.args);
      emit({ kind: "tool_result", name: `mcp__gatekeeper__${call.name}`, isError: /^(refused|unknown|error)/i.test(answer), text: answer });
      const text = `${handOff ? `Handed "${handOff[1].trim()}" to ${handOff[2].trim()}` : `Told ${tell![1].trim()}`}: ${answer.slice(0, 200)}`;
      emit({ kind: "text", text });
      return { ok: true, sessionId, text, usage };
    }
    const background = prompt.match(/^start a background job "([^"]{1,80})": (.+)$/im);
    if (background) {
      emit({ kind: "tool", name: "mcp__shell__start_job", input: { name: background[1], command: background[2] } });
      const bench = connectBench();
      try {
        const answer = await bench.call({ op: "job_start", id: `fake-${Date.now()}`, command: background[2].trim(), name: background[1] });
        const text = answer.op === "job_started" && answer.job ? `Started "${answer.job.name}" in the background as ${answer.job.id}.` : `I could not start it: ${answer.op === "job_started" ? answer.error : "no answer"}`;
        emit({ kind: "text", text });
        return { ok: true, sessionId, text, usage };
      } finally {
        bench.close();
      }
    }
    const clip = prompt.match(/^clip the first (\d{1,3}) seconds?\b/im);
    const shareBack = /^share (them|it) back\b/im.test(prompt);
    const files = attachedPaths(prompt);
    if ((clip || shareBack) && files.length) {
      const gatekeeper = await openGatekeeper(config.serverUrl, config.token, controller.signal);
      const shared: string[] = [];
      if (clip) {
        const video = files.find((file) => file.mime.startsWith("video/"));
        if (!video) {
          const text = "None of those files is a video, so there is nothing to clip.";
          emit({ kind: "text", text });
          return { ok: true, sessionId, text, usage };
        }
        const output = `${config.workDir}/outbox/clip-${video.path.split("/").pop()!.replace(/\.[^.]+$/, "")}.mp4`;
        emit({ kind: "tool", name: "mcp__shell__run_command", input: { command: `ffmpeg -t ${clip[1]} > ${output}` } });
        const bench = connectBench();
        try {
          const result = await bench.exec(clipCommand(video.path, Number(clip[1]), output), { timeoutMs: 300000 });
          emit({ kind: "tool_result", name: "mcp__shell__run_command", isError: result.code !== 0, text: (result.stdout + result.stderr).slice(0, 500) });
          if (result.code !== 0) {
            const text = `ffmpeg could not cut it: ${result.stderr.slice(0, 200)}`;
            emit({ kind: "text", text });
            return { ok: true, sessionId, text, usage };
          }
        } finally {
          bench.close();
        }
        const args = { path: output, caption: `The first ${clip[1]} seconds of ${video.path.split("/").pop()}.` };
        emit({ kind: "tool", name: "mcp__gatekeeper__share_file", input: args });
        const answer = await gatekeeper.call("share_file", args);
        emit({ kind: "tool_result", name: "mcp__gatekeeper__share_file", isError: /^not shared/i.test(answer), text: answer });
        shared.push(answer);
      } else {
        for (const file of files) {
          const args = { path: file.path };
          emit({ kind: "tool", name: "mcp__gatekeeper__share_file", input: args });
          const answer = await gatekeeper.call("share_file", args);
          emit({ kind: "tool_result", name: "mcp__gatekeeper__share_file", isError: /^not shared/i.test(answer), text: answer });
          shared.push(answer);
        }
      }
      const text = shared.every((answer) => answer.startsWith("shared")) ? `Done, ${shared.length === 1 ? "it is" : "they are"} in the chat.` : `Something failed: ${shared.join(" | ").slice(0, 300)}`;
      emit({ kind: "text", text });
      return { ok: true, sessionId, text, usage };
    }
    const publish = prompt.match(/^publish the file (\S+) as "([^"]{1,120})"/im);
    const edit = prompt.match(/artifact_id (art_[A-Za-z0-9_-]+)\), version \d+\.\nThat version is saved on your computer at "([^"]+)"/);
    if (publish || edit) {
      const gatekeeper = await openGatekeeper(config.serverUrl, config.token, controller.signal);
      let args: { path: string; title: string; artifact_id?: string; note?: string };
      if (edit) {
        const wanted = prompt.split("What your owner wants:\n")[1]?.split("\n")[0]?.trim() ?? "an edit";
        const title = prompt.match(/edit to the artifact "([^"]+)"/)?.[1] ?? "Artifact";
        const name = edit[2].split("/").pop()!;
        const output = `${config.workDir}/outbox/${name}`;
        const original = readFileSync(edit[2], "utf8");
        const line = wanted.replace(/[<>&]/g, "");
        writeFileSync(output, /\.html?$/i.test(name) ? `${original}\n<p>${line}</p>\n` : /\.md$/i.test(name) ? `${original}\n\n${line}\n` : original);
        args = { path: output, title, artifact_id: edit[1], note: wanted.slice(0, 120) };
      } else {
        args = { path: publish![1], title: publish![2] };
      }
      emit({ kind: "tool", name: "mcp__gatekeeper__publish_artifact", input: args });
      const answer = await gatekeeper.call("publish_artifact", args);
      emit({ kind: "tool_result", name: "mcp__gatekeeper__publish_artifact", isError: /^not published/i.test(answer), text: answer });
      const text = answer.startsWith("published") ? (edit ? "Changed it and published the next version." : "Here it is, beside the chat.") : `Something failed: ${answer.slice(0, 300)}`;
      emit({ kind: "text", text });
      return { ok: true, sessionId, text, usage };
    }
    const sheet = prompt.match(/^make a spreadsheet of (.+)$/im);
    if (sheet) {
      const name = sheet[1].trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "sheet";
      const script = SPREADSHEET_SCRIPT.replace("NAME", name);
      emit({ kind: "tool", name: "mcp__shell__run_command", input: { command: "python3 (openpyxl) > outbox" } });
      const bench = connectBench();
      try {
        const result = await bench.exec(`mkdir -p outbox && python3 - <<'PY'\n${script}\nPY`, { timeoutMs: 60000 });
        emit({ kind: "tool_result", name: "mcp__shell__run_command", isError: result.code !== 0, text: (result.stdout + result.stderr).slice(0, 500) });
        const text = result.code === 0 ? `Saved outbox/${name}.xlsx with this week's three invoices. Press Super+O on my screen to open it.` : `I could not make the spreadsheet: ${result.stderr.slice(0, 200)}`;
        emit({ kind: "text", text });
        return { ok: true, sessionId, text, usage };
      } finally {
        bench.close();
      }
    }
    const said = prompt.split("\n").filter(Boolean).at(-1) ?? "";
    const text = `I am the fake brain. You said: ${said.slice(0, 200)}`;
    emit({ kind: "text_start" });
    for (const word of text.match(/\S+\s*/g) ?? []) {
      emit({ kind: "text_delta", text: word });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    emit({ kind: "text", text });
    return { ok: true, sessionId, text, usage };
  };

  const done = work().catch((error: Error) => ({ ok: false, sessionId, text: "", error: error.message }));
  return { done, cancel: () => controller.abort() };
}
