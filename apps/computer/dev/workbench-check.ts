import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connectBench } from "../src/bench-client.ts";
import { desktopEnabled } from "../src/desktop.ts";

const HOME = process.env.HOME || "/home/agent";
const results: { check: string; ok: boolean; detail: string }[] = [];
const record = (check: string, ok: boolean, detail: string) => results.push({ check, ok, detail: detail.replace(/\s+/g, " ").slice(0, 220) });

const terminalOutput: string[] = [];
const jobBroadcasts: string[] = [];
const terminalExits: string[] = [];
const bench = connectBench((event) => {
  if (event.op === "term_output") terminalOutput.push(event.data);
  if (event.op === "term_exit") terminalExits.push(event.id);
  if (event.op === "jobs") jobBroadcasts.push(JSON.stringify(event.jobs));
});

const probe = await bench.exec(
  [
    "id -u",
    "pwd",
    "env",
    "curl -s -m 3 http://127.0.0.1:9222/json/version || echo CDP-UNREACHABLE",
  ].join("; echo ---; "),
  { timeoutMs: 60000 },
);
const everything = `${probe.stdout}\n${probe.stderr}`;
record("the workbench answers commands", probe.code !== null, `exit ${probe.code}`);
const startedIn = probe.stdout.split("---\n")[1]?.trim() ?? "";
record("the shell starts in the agent's home", startedIn === HOME, startedIn);
record("the shell does not inherit the agent token or the vault key", !/^(AGENT_TOKEN|UNDERSTUDY_VAULT_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)=/m.test(everything), "env checked");
record("the shell runs on the agent's computer and reaches its browser", /webSocketDebuggerUrl/.test(everything), /webSocketDebuggerUrl/.test(everything) ? "CDP reachable" : "CDP unreachable");

const tools = await bench.exec("soffice --version | head -1; python3 -c 'import pandas, openpyxl, pdfplumber; print(\"python-ok\")'; tesseract --list-langs 2>&1 | grep -c -E '^(eng|por)$'; pandoc --version | head -1; ffmpeg -version | head -1; pdftotext -v 2>&1 | head -1; sqlite3 --version", { timeoutMs: 60000 });
const toolText = tools.stdout + tools.stderr;
const toolsOk = /LibreOffice/.test(toolText) && /python-ok/.test(toolText) && /^2$/m.test(toolText) && /pandoc/.test(toolText) && /ffmpeg version/.test(toolText) && /pdftotext/.test(toolText) && /^3\./m.test(toolText);
record("the workbench has the office and data tools", toolsOk, toolText);

const jobStart = await bench.call({ op: "job_start", id: randomUUID(), command: "sleep 1; echo job-$((20+22))", name: "Check job" });
const jobId = jobStart.op === "job_started" ? jobStart.job?.id : undefined;
await new Promise((resolve) => setTimeout(resolve, 3000));
const jobRead = jobId ? await bench.call({ op: "job_output", id: randomUUID(), jobId }) : null;
const jobOk = jobRead?.op === "job_output_result" && jobRead.job?.status === "done" && jobRead.output.includes("job-42") && jobBroadcasts.some((line) => line.includes(jobId ?? "none"));
record("background jobs run in the workbench and are broadcast", Boolean(jobOk), jobRead?.op === "job_output_result" ? `${jobRead.job?.status} ${jobRead.output.trim()}, ${jobBroadcasts.length} broadcasts` : "no job");

const desktopChecks = () => {
  let desktop = "";
  try {
    desktop = execFileSync("bash", ["-lc", "xdotool getmouselocation; xwininfo -root -tree | grep -ci chrom"], { env: { ...process.env, DISPLAY: ":99" }, encoding: "utf8", timeout: 10000 });
  } catch (error) {
    desktop = String((error as Error).message);
  }
  let openboxEnv = "";
  try {
    const commOf = (entry: string) => {
      try {
        return readFileSync(`/proc/${entry}/comm`, "utf8").trim();
      } catch {
        return "";
      }
    };
    const pid = readdirSync("/proc").find((entry) => /^\d+$/.test(entry) && commOf(entry) === "openbox");
    openboxEnv = pid ? readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").join("\n") : "no openbox process";
  } catch (error) {
    openboxEnv = `unreadable: ${(error as Error).message}`;
  }
  const leaked = ["AGENT_TOKEN", "UNDERSTUDY_VAULT_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"].filter((name) => openboxEnv.split("\n").some((line) => line.startsWith(`${name}=`)));
  record("apps opened on the desktop do not inherit the agent's secrets", openboxEnv.includes("DISPLAY=:99") && leaked.length === 0, leaked.length ? `leaked ${leaked.join(", ")}` : openboxEnv.includes("DISPLAY=:99") ? "openbox env is clean" : openboxEnv.slice(0, 120));
  record("the desktop is up and Chromium runs on it", /x:\d+ y:\d+/.test(desktop) && /^[1-9]\d*$/m.test(desktop), desktop);
};
if (desktopEnabled()) desktopChecks();

const marker = `bench-${randomBytes(4).toString("hex")}`;
const write = await bench.exec(`mkdir -p files/outbox && echo ${marker} > files/outbox/workbench-check.txt`, { timeoutMs: 30000 });
let shared = "";
try {
  shared = readFileSync(join(HOME, "files", "outbox", "workbench-check.txt"), "utf8").trim();
} catch {}
record("files written in the workbench show up in the agent's outbox", write.code === 0 && shared === marker, `wrote ${write.code}, read "${shared}"`);

const terminalId = `check-${randomBytes(3).toString("hex")}`;
bench.send({ op: "term_open", id: terminalId, cols: 100, rows: 30 });
await new Promise((resolve) => setTimeout(resolve, 1500));
bench.send({ op: "term_input", id: terminalId, data: "echo terminal-$((40+2))\r" });
await new Promise((resolve) => setTimeout(resolve, 2500));
bench.send({ op: "term_resize", id: terminalId, cols: 120, rows: 40 });
const screen = terminalOutput.join("");
record("the terminal streams a real shell", screen.includes("terminal-42"), screen.includes("terminal-42") ? "saw terminal-42" : `saw ${JSON.stringify(screen.slice(-120))}`);

const exitsBefore = terminalExits.length;
bench.send({ op: "term_input", id: terminalId, data: "KEEP=still-$((6*7))\r" });
await new Promise((resolve) => setTimeout(resolve, 1000));
terminalOutput.length = 0;
bench.send({ op: "term_open", id: terminalId, cols: 120, rows: 40 });
await new Promise((resolve) => setTimeout(resolve, 2000));
const redrawn = terminalOutput.join("");
terminalOutput.length = 0;
bench.send({ op: "term_input", id: terminalId, data: "echo kept-$KEEP\r" });
await new Promise((resolve) => setTimeout(resolve, 2000));
const after = terminalOutput.join("");
const reattached = redrawn.includes("KEEP=still") && after.includes("kept-still-42") && terminalExits.length === exitsBefore;
record("reopening a terminal reattaches to the same shell and redraws it", reattached, `redrawn ${redrawn.includes("KEEP=still")}, same shell ${after.includes("kept-still-42")}, exits ${terminalExits.length - exitsBefore}`);
bench.send({ op: "term_close", id: terminalId });

bench.close();
for (const result of results) process.stdout.write(`${result.ok ? "PASS" : "FAIL"} ${result.check}: ${result.detail}\n`);
process.exit(results.every((result) => result.ok) ? 0 : 1);
