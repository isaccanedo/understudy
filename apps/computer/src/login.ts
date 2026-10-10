import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Brain, ComputerToServer } from "@understudy/protocol";
import { fakeBrainEnabled } from "./fake-brain.ts";
import { log } from "@understudy/runtime";

export type BrainStatus = { brain: Brain; loggedIn: boolean; account?: string };

export function codexSandboxWorks(env: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("codex", ["sandbox", "-c", 'sandbox_mode="workspace-write"', "--", "true"], { env, timeout: 30000 }, (error) => resolve(!error));
  });
}

export type LoginManager = {
  start: (brain: Brain) => Promise<void>;
  code: (brain: Brain, code: string) => Promise<void>;
  status: () => Promise<BrainStatus[]>;
};

const TMUX_SOCKET = "understudy";
const CLAUDE_SESSION = "login-claude";
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");
}

export function findClaudeLoginUrl(screen: string): string | null {
  const matches = screen.match(/https:\/\/(?:claude\.ai|console\.anthropic\.com|claude\.com)\/[^\s"'<>]+/g);
  return matches ? matches[matches.length - 1] : null;
}

export function findDeviceLogin(output: string): { url: string | null; code: string | null } {
  const clean = stripAnsi(output);
  const url = clean.match(/https:\/\/[^\s"'<>]*(?:device|activate)[^\s"'<>]*/i)?.[0] ?? clean.match(/https:\/\/auth\.openai\.com[^\s"'<>]*/)?.[0] ?? null;
  const code = clean.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0] ?? null;
  return { url, code };
}

export function apiKeyMode(brain: Brain, env: NodeJS.ProcessEnv): boolean {
  if (brain === "claude") return !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  return !!env.OPENAI_API_KEY;
}

export function emailFromJwt(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.email ?? claims["https://api.openai.com/profile"]?.email;
  } catch {
    return undefined;
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, timeout = 20000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { env, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as NodeJS.ErrnoException).code === "number" ? Number((error as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, out: `${stdout}${stderr}` });
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function prepareClaudeHome(home: string, workDir: string): void {
  const file = join(home, ".claude.json");
  let config: Record<string, any> = {};
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  config.hasCompletedOnboarding = true;
  config.bypassPermissionsModeAccepted = true;
  config.projects = config.projects ?? {};
  config.projects[workDir] = { ...(config.projects[workDir] ?? {}), hasTrustDialogAccepted: true };
  writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  mkdirSync(join(home, ".claude"), { recursive: true });
}

export function createLoginManager(options: {
  home: string;
  workDir: string;
  send: (message: ComputerToServer) => boolean;
  codexAvailable: () => boolean;
}): LoginManager {
  const env = { ...process.env, HOME: options.home };
  let codexChild: ChildProcess | null = null;
  let claudeActive = false;

  const tmux = (...args: string[]) => run("tmux", ["-L", TMUX_SOCKET, ...args], env);
  const pane = async () => stripAnsi((await tmux("capture-pane", "-t", CLAUDE_SESSION, "-p", "-J", "-S", "-200")).out);

  const claudeStatus = async (): Promise<BrainStatus> => {
    if (fakeBrainEnabled(env)) return { brain: "claude", loggedIn: true, account: "fake-brain" };
    if (apiKeyMode("claude", env)) return { brain: "claude", loggedIn: true, account: "api-key" };
    const result = await run("claude", ["auth", "status", "--json"], env);
    try {
      const parsed = JSON.parse(result.out.slice(result.out.indexOf("{")));
      return { brain: "claude", loggedIn: !!parsed.loggedIn, account: parsed.email ?? undefined };
    } catch {
      return { brain: "claude", loggedIn: false };
    }
  };

  const codexStatus = async (): Promise<BrainStatus> => {
    if (apiKeyMode("codex", env)) return { brain: "codex", loggedIn: true, account: "api-key" };
    const result = await run("codex", ["login", "status"], env);
    const loggedIn = result.code === 0 && /logged in/i.test(result.out);
    let account: string | undefined;
    if (loggedIn) {
      try {
        const auth = JSON.parse(readFileSync(join(options.home, ".codex", "auth.json"), "utf8"));
        account = emailFromJwt(auth?.tokens?.id_token ?? "");
      } catch {}
    }
    return { brain: "codex", loggedIn, account };
  };

  const startClaude = async () => {
    prepareClaudeHome(options.home, options.workDir);
    await tmux("kill-session", "-t", CLAUDE_SESSION);
    const started = await tmux("new-session", "-d", "-s", CLAUDE_SESSION, "-x", "400", "-y", "60", "claude auth login --claudeai; sleep 900");
    if (started.code !== 0) throw new Error(`tmux failed: ${started.out.trim()}`);
    claudeActive = true;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await sleep(1000);
      const screen = await pane();
      const url = findClaudeLoginUrl(screen);
      if (url) {
        options.send({
          type: "login_prompt",
          brain: "claude",
          url,
          message: "Open the link, sign in with your Claude account, authorize, and paste the code it shows.",
        });
        return;
      }
      if (/Login successful/i.test(screen)) {
        await finishClaude();
        return;
      }
    }
    claudeActive = false;
    await tmux("kill-session", "-t", CLAUDE_SESSION);
    options.send({ type: "login_done", brain: "claude", ok: false, message: "The Claude login did not show a link in time. Try again." });
  };

  const finishClaude = async () => {
    claudeActive = false;
    await tmux("kill-session", "-t", CLAUDE_SESSION);
    prepareClaudeHome(options.home, options.workDir);
    const status = await claudeStatus();
    options.send({
      type: "login_done",
      brain: "claude",
      ok: status.loggedIn,
      account: status.account,
      message: status.loggedIn ? undefined : "The login finished but Claude still reports no account.",
    });
  };

  const codeClaude = async (code: string) => {
    if (!claudeActive) {
      options.send({ type: "login_done", brain: "claude", ok: false, message: "No Claude login is waiting for a code. Start the login again." });
      return;
    }
    await tmux("send-keys", "-t", CLAUDE_SESSION, "-l", code.trim());
    await sleep(500);
    await tmux("send-keys", "-t", CLAUDE_SESSION, "Enter");
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      await sleep(1000);
      const screen = await pane();
      if (/Login successful/i.test(screen)) {
        await finishClaude();
        return;
      }
      if (/(OAuth error|Invalid code|Login failed|Authorization failed)/i.test(screen.split("\n").slice(-8).join("\n"))) {
        const tail = screen.trim().split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300);
        claudeActive = false;
        await tmux("kill-session", "-t", CLAUDE_SESSION);
        options.send({ type: "login_done", brain: "claude", ok: false, message: tail || "Claude refused the code." });
        return;
      }
    }
    claudeActive = false;
    await tmux("kill-session", "-t", CLAUDE_SESSION);
    options.send({ type: "login_done", brain: "claude", ok: false, message: "Claude did not confirm the login in time." });
  };

  const startCodex = async () => {
    codexChild?.kill("SIGTERM");
    const child = spawn("codex", ["login", "--device-auth"], { env, stdio: ["ignore", "pipe", "pipe"] });
    codexChild = child;
    let output = "";
    let prompted = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), LOGIN_TIMEOUT_MS);
    const promptIfReady = (force: boolean) => {
      if (prompted) return;
      const found = findDeviceLogin(output);
      if (!(found.url && found.code) && !force) return;
      if (!found.url && !found.code) return;
      prompted = true;
      options.send({
        type: "login_prompt",
        brain: "codex",
        url: found.url ?? undefined,
        code: found.code ?? undefined,
        message: "Open the link, sign in with your ChatGPT account, and enter the code.",
      });
    };
    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8000);
      promptIfReady(false);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    setTimeout(() => promptIfReady(true), 8000).unref();
    child.on("close", async (code) => {
      clearTimeout(timer);
      if (codexChild !== child) return;
      codexChild = null;
      if (code !== 0) {
        const tail = stripAnsi(output).trim().split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300);
        options.send({ type: "login_done", brain: "codex", ok: false, message: tail || `codex login exited ${code}` });
        return;
      }
      const status = await codexStatus();
      options.send({ type: "login_done", brain: "codex", ok: status.loggedIn, account: status.account });
    });
    child.on("error", (error) => {
      options.send({ type: "login_done", brain: "codex", ok: false, message: `could not start codex: ${error.message}` });
    });
  };

  return {
    async start(brain) {
      if (fakeBrainEnabled(env) && brain === "claude") {
        options.send({ type: "login_done", brain, ok: true, account: "fake-brain", message: "This computer runs the fake brain for tests." });
        return;
      }
      if (apiKeyMode(brain, env)) {
        options.send({ type: "login_done", brain, ok: true, account: "api-key", message: "This computer uses an API key for this brain; no login needed." });
        return;
      }
      if (brain === "codex" && !options.codexAvailable()) {
        options.send({ type: "login_done", brain, ok: false, message: "Codex is turned off on this computer." });
        return;
      }
      log("login", `starting ${brain} login`);
      try {
        if (brain === "claude") await startClaude();
        else await startCodex();
      } catch (error) {
        options.send({ type: "login_done", brain, ok: false, message: (error as Error).message });
      }
    },
    async code(brain, code) {
      if (brain === "claude") await codeClaude(code);
    },
    async status() {
      return options.codexAvailable() ? Promise.all([claudeStatus(), codexStatus()]) : [await claudeStatus()];
    },
  };
}
