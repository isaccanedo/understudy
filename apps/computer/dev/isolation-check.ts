import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { CDP_ENDPOINT } from "../src/browser.ts";
import { claudeArgs, claudeEnv } from "../src/brain.ts";

const HOME = process.env.HOME || "/home/agent";
const FILES = join(HOME, "files");
const results: { check: string; ok: boolean; detail: string }[] = [];
const record = (check: string, ok: boolean, detail: string) => results.push({ check, ok, detail: detail.replace(/\s+/g, " ").slice(0, 200) });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdpFileNavigation() {
  const targets = (await (await fetch(`${CDP_ENDPOINT}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((target) => target.type === "page");
  if (!page) return record("chromium blocks file:// URLs", false, "no page target");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.once("open", resolve));
  let next = 0;
  const call = (method: string, params: Record<string, unknown>) =>
    new Promise<any>((resolve) => {
      const id = ++next;
      const onMessage = (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString());
        if (message.id !== id) return;
        socket.off("message", onMessage);
        resolve(message);
      };
      socket.on("message", onMessage);
      socket.send(JSON.stringify({ id, method, params }));
    });
  await call("Page.navigate", { url: `file://${HOME}/.claude.json` });
  await wait(1500);
  const seen = await call("Runtime.evaluate", { expression: "location.href", returnByValue: true });
  socket.close();
  const href = String(seen.result?.result?.value ?? "");
  record("chromium blocks file:// URLs", !href.startsWith("file:"), href);
}

async function playwrightUpload() {
  const child = spawn("playwright-mcp", ["--cdp-endpoint", CDP_ENDPOINT], { cwd: FILES });
  const responses = new Map<number, any>();
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        if (message.id) responses.set(message.id, message.result ?? message.error);
      } catch {}
    }
  });
  let next = 1;
  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const call = async (name: string, args: Record<string, unknown>, settle = 3000) => {
    const id = ++next;
    send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    await wait(settle);
    return JSON.stringify(responses.get(id) ?? "");
  };
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "isolation-check", version: "1" } } });
  await wait(1500);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const navigation = await call("browser_navigate", { url: `file://${HOME}/.understudy/vault.key` });
  record("playwright refuses file:// navigation", /blocked|denied/i.test(navigation), navigation);
  const formUrl = process.argv[2];
  if (formUrl) {
    await call("browser_navigate", { url: formUrl }, 4000);
    await call("browser_snapshot", {});
    const snapshots = join(FILES, ".playwright-mcp");
    const latest = readdirSync(snapshots).map((name) => join(snapshots, name)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    const ref = readFileSync(latest, "utf8").match(/button "[^"]*" \[ref=([a-z0-9]+)\]/)?.[1];
    await call("browser_click", { element: "file input", target: ref });
    const upload = await call("browser_file_upload", { paths: [join(HOME, ".understudy", "vault.key")] });
    record("playwright refuses uploads outside ~/files", /outside allowed roots|denied/i.test(upload), upload);
  }
  child.kill();
}

function claudeRules() {
  const args = claudeArgs("{}", "x");
  const denied = new Set(args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--append-system-prompt")));
  const needed = ["Read(~/.claude/**)", "Read(~/.codex/**)", "Read(~/.understudy/**)", "Read(//proc/**)", "Write(**/.claude/**)"];
  const missing = needed.filter((rule) => !denied.has(rule));
  record("claude denies reading and writing secret paths", missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : `${denied.size} rules`);
  const allowed = ["Bash", "mcp__browser__browser_evaluate"].filter((rule) => denied.has(rule));
  record("claude may use its shell and page JavaScript", allowed.length === 0, allowed.length ? `still denied ${allowed.join(", ")}` : "allowed");
  const env = claudeEnv(process.env, HOME);
  record("claude does not inherit the agent token", env.AGENT_TOKEN === undefined && env.UNDERSTUDY_VAULT_KEY === undefined, "env checked");
}

claudeRules();
await cdpFileNavigation();
await playwrightUpload();
for (const result of results) process.stdout.write(`${result.ok ? "PASS" : "FAIL"} ${result.check}: ${result.detail}\n`);
process.exit(results.every((result) => result.ok) ? 0 : 1);
