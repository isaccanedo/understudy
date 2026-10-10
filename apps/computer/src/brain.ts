import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Brain, Usage } from "@understudy/protocol";
import { gatekeeperUrl } from "./endpoints.ts";
import { fakeBrainEnabled, startFakeTurn } from "./fake-brain.ts";
import { log } from "@understudy/runtime";

export type BrainEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "text_start" }
  | { kind: "text_delta"; text: string }
  | { kind: "thinking" }
  | { kind: "tool"; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; name: string; isError: boolean; text: string };

export type TurnResult = { ok: boolean; sessionId: string | null; text: string; error?: string; usage?: Usage };

export function addUsage(total: Usage | undefined, more: Usage | undefined): Usage | undefined {
  if (!more) return total;
  if (!total) return { ...more };
  const costUsd = total.costUsd !== undefined || more.costUsd !== undefined ? (total.costUsd ?? 0) + (more.costUsd ?? 0) : undefined;
  return { inputTokens: total.inputTokens + more.inputTokens, outputTokens: total.outputTokens + more.outputTokens, ...(costUsd !== undefined ? { costUsd } : {}) };
}

export function usageFromLine(line: string): Usage | undefined {
  let message: Record<string, any>;
  try {
    message = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (message.type === "result" && message.usage) {
    const usage = message.usage;
    const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    const cost = typeof message.total_cost_usd === "number" && message.total_cost_usd > 0 ? { costUsd: message.total_cost_usd } : {};
    return { inputTokens, outputTokens: usage.output_tokens ?? 0, ...cost };
  }
  if (message.type === "turn.completed" && message.usage) {
    return { inputTokens: message.usage.input_tokens ?? 0, outputTokens: message.usage.output_tokens ?? 0 };
  }
  return undefined;
}

export type TurnRequest = {
  brain: Brain;
  model?: string;
  prompt: string;
  system: string;
  resume?: string | null;
  onEvent: (event: BrainEvent) => void;
};

export type Turn = { done: Promise<TurnResult>; cancel: () => void };

export type BrainConfig = {
  home: string;
  workDir: string;
  serverUrl: string;
  token: string;
};

export const APPROVAL_POLL_MS = 60 * 60 * 1000;

export const VAULT_MCP_PATH = new URL("./vault-mcp.ts", import.meta.url).pathname;

const VAULT_MCP_ARGS = ["--experimental-strip-types", "--no-warnings", VAULT_MCP_PATH];

export const GUARD_PATH = new URL("./browser-guard.ts", import.meta.url).pathname;

export const SHELL_MCP_ARGS = ["--experimental-strip-types", "--no-warnings", new URL("./shell-mcp.ts", import.meta.url).pathname];

export const DESKTOP_MCP_ARGS = ["--experimental-strip-types", "--no-warnings", new URL("./desktop-mcp.ts", import.meta.url).pathname];

export function desktopMcpEnv(home: string): Record<string, string> {
  return { HOME: home, DISPLAY: process.env.DISPLAY || ":99", PATH: `${home}/.local/bin:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}` };
}

const GUARD_ARGS = ["--experimental-strip-types", "--no-warnings", GUARD_PATH];

export function guardEnv(config: BrainConfig): Record<string, string> {
  return {
    HOME: config.home,
    AGENT_TOKEN: config.token,
    UNDERSTUDY_SERVER_URL: config.serverUrl,
    ...(process.env.UNDERSTUDY_VAULT_KEY ? { UNDERSTUDY_VAULT_KEY: process.env.UNDERSTUDY_VAULT_KEY } : {}),
    ...(process.env.PLAYWRIGHT_MCP_BIN ? { PLAYWRIGHT_MCP_BIN: process.env.PLAYWRIGHT_MCP_BIN } : {}),
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
  };
}

export function claudeMcpConfig(config: BrainConfig) {
  return {
    mcpServers: {
      browser: { type: "stdio", command: process.execPath, args: GUARD_ARGS, env: guardEnv(config) },
      shell: { type: "stdio", command: process.execPath, args: SHELL_MCP_ARGS, env: { HOME: config.home } },
      desktop: { type: "stdio", command: process.execPath, args: DESKTOP_MCP_ARGS, env: desktopMcpEnv(config.home) },
      vault: {
        type: "stdio",
        command: process.execPath,
        args: VAULT_MCP_ARGS,
        env: { HOME: config.home, ...(process.env.UNDERSTUDY_VAULT_KEY ? { UNDERSTUDY_VAULT_KEY: process.env.UNDERSTUDY_VAULT_KEY } : {}) },
      },
      gatekeeper: {
        type: "http",
        url: gatekeeperUrl(config.serverUrl),
        headers: { Authorization: `Bearer ${config.token}` },
      },
    },
  };
}

export const PROTECTED_PATHS = ["~/.claude/**", "~/.claude.json", "~/.codex/**", "~/.understudy/**", "//proc/**", "//tmp/**", "**/.claude/**", "**/.mcp.json"];

export const PROTECTED_TOOL_RULES = PROTECTED_PATHS.flatMap((path) => ["Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit"].map((tool) => `${tool}(${path})`));

export function claudeEnv(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const { AGENT_TOKEN: _token, UNDERSTUDY_VAULT_KEY: _vault, ...rest } = env;
  return { ...rest, HOME: home, MCP_TOOL_TIMEOUT: String(APPROVAL_POLL_MS), ENABLE_TOOL_SEARCH: "false" };
}

export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,99}$/;

export function validModel(model: string | undefined | null): string | undefined {
  const value = (model ?? "").trim();
  return value && MODEL_NAME.test(value) ? value : undefined;
}

export function claudeArgs(mcpConfig: string, system: string, resume?: string | null, model?: string): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--mcp-config",
    mcpConfig,
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions",
    "--disallowedTools",
    ...PROTECTED_TOOL_RULES,
    "--append-system-prompt",
    system,
  ];
  if (validModel(model)) args.push("--model", validModel(model)!);
  if (resume) args.push("--resume", resume);
  return args;
}

export function codexEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.UNDERSTUDY_ENABLE_CODEX === "true";
}

export function codexArgs(config: BrainConfig, resume?: string | null, model?: string): string[] {
  const toml = (value: unknown) => JSON.stringify(value);
  const options = [
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "danger-full-access",
    "--cd",
    config.workDir,
    "-c",
    'approval_policy="never"',
    "-c",
    `mcp_servers.browser.command=${toml(process.execPath)}`,
    "-c",
    `mcp_servers.browser.args=${toml(GUARD_ARGS)}`,
    "-c",
    `mcp_servers.browser.env={ ${Object.entries(guardEnv(config)).map(([key, value]) => `${key} = ${toml(value)}`).join(", ")} }`,
    "-c",
    `mcp_servers.gatekeeper.url=${toml(gatekeeperUrl(config.serverUrl))}`,
    "-c",
    `mcp_servers.gatekeeper.bearer_token_env_var="AGENT_TOKEN"`,
    "-c",
    `mcp_servers.gatekeeper.tool_timeout_sec=${APPROVAL_POLL_MS / 1000}`,
    "-c",
    `mcp_servers.shell.command=${toml(process.execPath)}`,
    "-c",
    `mcp_servers.shell.args=${toml(SHELL_MCP_ARGS)}`,
    "-c",
    `mcp_servers.desktop.command=${toml(process.execPath)}`,
    "-c",
    `mcp_servers.desktop.args=${toml(DESKTOP_MCP_ARGS)}`,
    "-c",
    `mcp_servers.desktop.env={ ${Object.entries(desktopMcpEnv(config.home)).map(([key, value]) => `${key} = ${toml(value)}`).join(", ")} }`,
    "-c",
    "experimental_use_rmcp_client=true",
  ];
  if (validModel(model)) options.push("--model", validModel(model)!);
  return resume ? ["exec", ...options, "resume", resume, "-"] : ["exec", ...options, "-"];
}

export function parseClaudeLine(line: string, tools: Map<string, string>): BrainEvent[] {
  let message: Record<string, any>;
  try {
    message = JSON.parse(line);
  } catch {
    return [];
  }
  const events: BrainEvent[] = [];
  if (message.type === "system" && message.subtype === "init" && message.session_id) {
    events.push({ kind: "session", sessionId: message.session_id });
  }
  if (message.type === "stream_event" && !message.parent_tool_use_id) {
    const event = message.event ?? {};
    if (event.type === "content_block_start" && event.content_block?.type === "text") events.push({ kind: "text_start" });
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") events.push({ kind: "text_delta", text: event.delta.text });
  }
  if (message.type === "assistant") {
    for (const block of message.message?.content ?? []) {
      if (block.type === "text" && block.text?.trim()) events.push({ kind: "text", text: block.text });
      if (block.type === "thinking") events.push({ kind: "thinking" });
      if (block.type === "tool_use") {
        tools.set(block.id, block.name);
        events.push({ kind: "tool", name: block.name, input: block.input ?? {} });
      }
    }
  }
  if (message.type === "user") {
    for (const block of message.message?.content ?? []) {
      if (block.type !== "tool_result") continue;
      const content = Array.isArray(block.content)
        ? block.content.map((part: { text?: string }) => part.text ?? "").join("\n")
        : String(block.content ?? "");
      events.push({ kind: "tool_result", name: tools.get(block.tool_use_id) ?? "", isError: !!block.is_error, text: content });
    }
  }
  return events;
}

export function parseCodexLine(line: string): BrainEvent[] {
  let message: Record<string, any>;
  try {
    message = JSON.parse(line);
  } catch {
    return [];
  }
  if (message.type === "thread.started" && message.thread_id) return [{ kind: "session", sessionId: message.thread_id }];
  const item = message.item;
  if (!item) return [];
  if (message.type === "item.started") {
    if (item.type === "reasoning") return [{ kind: "thinking" }];
    if (item.type === "mcp_tool_call") return [{ kind: "tool", name: `mcp__${item.server}__${item.tool}`, input: item.arguments ?? {} }];
    if (item.type === "command_execution") return [{ kind: "tool", name: "shell", input: { command: item.command } }];
    return [];
  }
  if (message.type === "item.completed") {
    if (item.type === "agent_message" && item.text?.trim()) return [{ kind: "text", text: item.text }];
    if (item.type === "mcp_tool_call") {
      const text = JSON.stringify(item.result ?? item.error ?? "");
      return [{ kind: "tool_result", name: `mcp__${item.server}__${item.tool}`, isError: item.status === "failed" || !!item.error, text }];
    }
  }
  return [];
}

export function claudeResult(line: string): { ok: boolean; text: string; sessionId?: string } | null {
  try {
    const message = JSON.parse(line);
    if (message.type !== "result") return null;
    return { ok: !message.is_error, text: String(message.result ?? ""), sessionId: message.session_id };
  } catch {
    return null;
  }
}

export function codexFailure(line: string): string | null {
  try {
    const message = JSON.parse(line);
    if (message.type === "turn.failed") return String(message.error?.message ?? "turn failed");
    return null;
  } catch {
    return null;
  }
}

export function startTurn(config: BrainConfig, request: TurnRequest): Turn {
  if (fakeBrainEnabled()) return startFakeTurn(config, request);
  mkdirSync(config.workDir, { recursive: true });
  let child: ChildProcess;
  if (request.brain === "claude") {
    child = spawn("claude", claudeArgs(JSON.stringify(claudeMcpConfig(config)), request.system, request.resume, request.model), {
      cwd: config.workDir,
      env: claudeEnv(process.env, config.home),
      stdio: ["pipe", "pipe", "pipe"],
    });
  } else {
    child = spawn("codex", codexArgs(config, request.resume, request.model), {
      cwd: config.workDir,
      env: { ...process.env, HOME: config.home, AGENT_TOKEN: config.token, ...(process.env.OPENAI_API_KEY ? { CODEX_API_KEY: process.env.OPENAI_API_KEY } : {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  const prompt = request.brain === "codex" && !request.resume ? `${request.system}\n\n---\n\n${request.prompt}` : request.prompt;
  child.stdin?.end(prompt);
  const tools = new Map<string, string>();
  let sessionId: string | null = request.resume ?? null;
  let finalText = "";
  let lastText = "";
  let failure: string | undefined;
  let resultOk: boolean | null = null;
  let stderr = "";
  let usage: Usage | undefined;

  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  const lines = createInterface({ input: child.stdout! });
  lines.on("line", (line) => {
    usage = addUsage(usage, usageFromLine(line));
    const events = request.brain === "claude" ? parseClaudeLine(line, tools) : parseCodexLine(line);
    for (const event of events) {
      if (event.kind === "session") sessionId = event.sessionId;
      if (event.kind === "text") lastText = event.text;
      request.onEvent(event);
    }
    if (request.brain === "claude") {
      const result = claudeResult(line);
      if (result) {
        resultOk = result.ok;
        finalText = result.text;
        if (result.sessionId) sessionId = result.sessionId;
        if (!result.ok) failure = result.text || "the brain reported an error";
      }
    } else {
      const failed = codexFailure(line);
      if (failed) failure = failed;
    }
  });

  const done = new Promise<TurnResult>((resolve) => {
    child.on("error", (error) => {
      failure = `could not start ${request.brain}: ${error.message}`;
    });
    child.on("close", (code) => {
      const ok = code === 0 && !failure && resultOk !== false;
      if (!ok) log("brain", `${request.brain} exited ${code}: ${failure ?? stderr.trim().split("\n").slice(-3).join(" | ")}`);
      resolve({
        ok,
        sessionId,
        text: finalText || lastText,
        error: ok ? undefined : failure ?? (stderr.trim().split("\n").slice(-3).join(" ") || `exit ${code}`),
        ...(usage ? { usage } : {}),
      });
    });
  });

  return { done, cancel: cancelChild(child) };
}

export function cancelChild(child: ChildProcess, graceMs = 5000) {
  let cancelling = false;
  const release = () => {
    child.stdout?.destroy();
    child.stderr?.destroy();
  };
  child.once("exit", () => {
    if (cancelling) release();
  });
  return () => {
    if (child.exitCode !== null || child.signalCode !== null) return release();
    cancelling = true;
    child.kill("SIGINT");
    setTimeout(() => child.kill("SIGKILL"), graceMs).unref();
  };
}
