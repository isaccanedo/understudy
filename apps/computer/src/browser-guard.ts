import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { AMOUNT_LABEL, describeRule, findViolation, looksIrreversible, type OwnerRule, type RuleViolation } from "@understudy/protocol";
import { CDP_ENDPOINT } from "./browser.ts";
import { openGatekeeper, type McpSession } from "./gatekeeper-client.ts";
import { readTurnState, turnStateFile, type TurnState } from "./turn-state.ts";
import { readRules, rulesFile } from "./rules-store.ts";
import { openVault } from "./vault.ts";

export const HIDDEN_TOOLS = new Set<string>();

export type ElementInfo = {
  tag: string;
  type: string;
  role: string;
  name: string;
  label?: string;
  isSubmit: boolean;
  inForm: boolean;
  editable: boolean;
  url: string;
  fields: { label: string; value: string }[];
};

export type Verdict = { kind: "pass" } | { kind: "block"; reason: string } | { kind: "ask"; summary: string; stepId?: string; fields: { label: string; value: string }[] };

export const ELEMENT_INFO = `(el) => {
  const element = el || document.activeElement || document.body;
  const form = element.closest ? element.closest("form") : null;
  const tag = (element.tagName || "").toLowerCase();
  const type = (element.getAttribute && element.getAttribute("type") || "").toLowerCase();
  const role = (element.getAttribute && element.getAttribute("role") || "").toLowerCase();
  const name = ((element.getAttribute && element.getAttribute("aria-label")) || element.innerText || element.value || element.title || "").trim().replace(/\\s+/g, " ").slice(0, 200);
  const label = ((element.labels && element.labels[0] && element.labels[0].innerText) || (element.getAttribute && (element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.getAttribute("name") || element.id)) || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const isSubmit = (tag === "button" && (type === "" || type === "submit") && !!form) || (tag === "input" && (type === "submit" || type === "image"));
  const editable = tag === "textarea" || element.isContentEditable === true;
  const fields = form ? Array.from(form.elements).filter((f) => (f.name || f.id) && f.type !== "hidden" && f.type !== "submit" && f.tagName !== "BUTTON").slice(0, 12).map((f) => ({
    label: ((f.labels && f.labels[0] && f.labels[0].innerText) || f.getAttribute("aria-label") || f.getAttribute("placeholder") || f.name || f.id || "").trim().slice(0, 80),
    value: f.type === "password" ? "••••••" : (f.type === "checkbox" || f.type === "radio") ? String(f.checked) : String(f.value == null ? "" : f.value).slice(0, 300),
  })) : [];
  return { tag, type, role, name, label, isSubmit, inForm: !!form, editable, url: location.href, fields };
}`;

export function parseEvaluateResult(text: string): ElementInfo | null {
  const body = text.match(/### Result\s*\n([\s\S]*?)(?:\n### |$)/)?.[1]?.trim();
  if (!body) return null;
  try {
    const value = JSON.parse(body);
    return value && typeof value.tag === "string" ? value : null;
  } catch {
    return null;
  }
}

export const UNKNOWN_ELEMENT: ElementInfo = { tag: "unknown", type: "", role: "", name: "", isSubmit: false, inForm: false, editable: false, url: "", fields: [] };

export function commitReason(tool: string, args: Record<string, unknown>, info: ElementInfo | null): string | null {
  if (!info) {
    if (tool === "browser_press_key" && String(args.key) !== "Enter") return null;
    if (tool === "browser_type" && args.submit !== true) return null;
    return "an action on an element the computer could not inspect";
  }
  const loginForm = info.isSubmit && info.fields.length <= 3 && info.fields.some((field) => field.value === "••••••") && !looksIrreversible(info.name);
  if (loginForm) return null;
  if (tool === "browser_click") {
    if (info.isSubmit) return `submit "${info.name || "form"}"`;
    if (looksIrreversible(info.name)) return `click "${info.name}"`;
    return null;
  }
  if (tool === "browser_press_key") {
    if (String(args.key) !== "Enter") return null;
    if (info.isSubmit) return `submit "${info.name || "form"}"`;
    if (info.inForm && info.tag === "input") return "press Enter in a form";
    if ((info.tag === "button" || info.tag === "a" || info.role === "button" || info.role === "link") && looksIrreversible(info.name)) return `press Enter on "${info.name}"`;
    return null;
  }
  if (tool === "browser_type" && args.submit === true && !info.editable) return "type and submit";
  return null;
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((word) => word.length > 2));
}

export function matchStep(name: string, steps: { id: string; text: string }[]): { id: string; text: string } | undefined {
  const target = words(name);
  let best: { id: string; text: string } | undefined;
  let bestScore = 0;
  for (const step of steps) {
    const score = [...words(step.text)].filter((word) => target.has(word)).length;
    if (score > bestScore) {
      best = step;
      bestScore = score;
    }
  }
  return best;
}

export function decide(state: TurnState, reason: string | null, info: ElementInfo | null): Verdict {
  if (!reason || !info) return { kind: "pass" };
  if (state.mode === "recipe") return { kind: "block", reason: "blocked: while learning a task nothing is submitted or sent" };
  if (state.mode === "run" && state.approvalsRequired === false) return { kind: "pass" };
  let host = info.url;
  try {
    host = new URL(info.url).host;
  } catch {}
  const step = matchStep(info.name, state.askSteps ?? []);
  return {
    kind: "ask",
    summary: `${reason.charAt(0).toUpperCase()}${reason.slice(1)} on ${host}`.slice(0, 480),
    stepId: step?.id,
    fields: [
      { label: "Step", value: step ? step.text : state.mode === "run" ? "Not a step of the recipe" : "Asked in chat" },
      { label: "Page", value: info.url.slice(0, 300) },
      ...info.fields.filter((field) => field.label),
    ].slice(0, 14),
  };
}

export const RECIPIENT_LABEL = /\b(to|cc|bcc|recipients?|send to|forward to|share with|invite|para|destinat\w*|copia)\b/i;

export const RULE_CHECKED_TOOLS = new Set(["browser_navigate", "browser_tabs", "browser_type", "browser_fill_form", "browser_select_option", "browser_click", "browser_press_key"]);

export function ruleCheck(rules: OwnerRule[], tool: string, args: Record<string, unknown>, info: ElementInfo | null, committing: boolean): RuleViolation | null {
  if (!rules.length) return null;
  const urls: string[] = [];
  const texts: string[] = [];
  const amounts: string[] = [];
  const amountLike = (label: string) => AMOUNT_LABEL.test(label);
  const recipientLike = (label: string) => RECIPIENT_LABEL.test(label);
  if (tool === "browser_navigate" && typeof args.url === "string") urls.push(args.url);
  if (tool === "browser_tabs" && typeof args.url === "string") urls.push(args.url);
  if (info?.url) urls.push(info.url);
  if (tool === "browser_type" && typeof args.text === "string") {
    const label = `${info?.label ?? ""} ${String(args.element ?? "")}`;
    if (recipientLike(label) || info?.editable) texts.push(args.text);
    if (amountLike(label)) amounts.push(args.text);
  }
  if (tool === "browser_fill_form" && Array.isArray(args.fields)) {
    for (const field of args.fields.slice(0, 100) as { name?: unknown; value?: unknown }[]) {
      const value = String(field?.value ?? "");
      if (recipientLike(String(field?.name ?? ""))) texts.push(value);
      if (amountLike(String(field?.name ?? ""))) amounts.push(value);
    }
  }
  if (tool === "browser_select_option" && Array.isArray(args.values)) {
    const values = args.values.map(String);
    if (recipientLike(`${info?.label ?? ""} ${String(args.element ?? "")}`)) texts.push(...values);
    if (amountLike(`${info?.label ?? ""} ${String(args.element ?? "")}`)) amounts.push(...values);
  }
  if (committing && info) {
    texts.push(info.name, ...info.fields.map((field) => field.value));
    amounts.push(...info.fields.filter((field) => amountLike(field.label)).map((field) => field.value));
    if (amountLike(info.name)) amounts.push(info.name);
  }
  return findViolation(rules, { urls, texts, amounts });
}

export function ruleBlockText(violation: RuleViolation): string {
  return `blocked by your owner's rule "${describeRule(violation.rule)}": ${violation.reason}. Do not try another way; stop and tell your owner.`;
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    for (const form of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])) {
      out = out.split(form).join("••••••");
    }
  }
  return out;
}

export function notifyGuardSocket(path: string, event: Record<string, unknown>, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    const timer = setTimeout(() => socket.destroy(), timeoutMs);
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.end(`${JSON.stringify(event)}\n`);
  });
}

type Rpc = { jsonrpc: "2.0"; id?: string | number; method?: string; params?: any; result?: any; error?: any };

async function serve() {
  const home = process.env.HOME || "/home/agent";
  const stateFile = process.env.UNDERSTUDY_TURN_FILE || turnStateFile(home);
  const serverUrl = process.env.UNDERSTUDY_SERVER_URL || "";
  const token = process.env.AGENT_TOKEN || "";
  const vault = openVault(home);
  const secrets = () => vault.list().flatMap((entry) => [vault.reveal(entry.name)?.secret ?? ""]);
  const child = spawn(process.env.PLAYWRIGHT_MCP_BIN || "playwright-mcp", ["--cdp-endpoint", CDP_ENDPOINT], { stdio: ["pipe", "pipe", "inherit"] });
  const toBrain = (message: Rpc) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const toChild = (message: Rpc) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const own = new Map<string, (message: Rpc) => void>();
  const pendingResults = new Map<string | number, (message: Rpc) => Rpc>();
  let next = 0;
  let gatekeeper: Promise<McpSession> | null = null;

  const notifyMain = (event: Record<string, unknown>) => notifyGuardSocket(process.env.UNDERSTUDY_GUARD_SOCKET || `${home}/.understudy/guard.sock`, event);

  const childCall = (name: string, args: Record<string, unknown>) =>
    new Promise<Rpc>((resolve) => {
      const id = `guard-${++next}`;
      own.set(id, resolve);
      toChild({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    });

  const elementInfo = async (target?: unknown): Promise<ElementInfo | null> => {
    const reply = await childCall("browser_evaluate", target ? { function: ELEMENT_INFO, target, element: "element the agent is acting on" } : { function: ELEMENT_INFO.replace("(el) =>", "() =>").replace("el || document.activeElement", "document.activeElement") });
    const text: string = reply.result?.content?.map((part: { text?: string }) => part.text ?? "").join("\n") ?? "";
    return parseEvaluateResult(text);
  };

  const textResult = (id: Rpc["id"], text: string, isError = true): Rpc => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError } });

  const askOwner = async (verdict: Extract<Verdict, { kind: "ask" }>, state: TurnState): Promise<{ approved: boolean; text: string; requestId?: string }> => {
    if (!serverUrl || !token) return { approved: false, text: "no gatekeeper configured" };
    gatekeeper ??= openGatekeeper(serverUrl, token);
    const session = await gatekeeper;
    await notifyMain({ event: "waiting", summary: verdict.summary });
    try {
      let answer = await session.call("request_approval", { summary: verdict.summary, fields: verdict.fields, ...(state.runId ? { runId: state.runId } : {}), ...(verdict.stepId ? { stepId: verdict.stepId } : {}) });
      const requestId = answer.match(/request_?id\W{1,8}([A-Za-z0-9_-]{4,})/i)?.[1];
      while (/status\W{1,8}pending/i.test(answer) && requestId) answer = await session.call("wait_for_approval", { requestId });
      return { approved: /^\s*approved/i.test(answer), text: answer, requestId };
    } finally {
      await notifyMain({ event: "resumed" });
    }
  };

  const guarded = async (message: Rpc) => {
    const tool = String(message.params?.name ?? "");
    const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
    if (HIDDEN_TOOLS.has(tool)) return toBrain(textResult(message.id, `${tool} is not available to the agent.`));
    const rules = readRules(rulesFile(home));
    const blockForRule = async (violation: RuleViolation) => {
      await notifyMain({ event: "rule_blocked", ruleId: violation.rule.id, rule: describeRule(violation.rule), detail: violation.reason });
      return toBrain(textResult(message.id, ruleBlockText(violation)));
    };
    if (tool !== "browser_click" && tool !== "browser_press_key" && tool !== "browser_type") {
      if (rules.length && RULE_CHECKED_TOOLS.has(tool)) {
        const pageInfo = tool === "browser_navigate" || tool === "browser_tabs" ? null : await elementInfo(args.target ?? undefined);
        const violation = ruleCheck(rules, tool, args, pageInfo, false);
        if (violation) return blockForRule(violation);
      }
      return toChild(message);
    }
    const info = await elementInfo(tool === "browser_press_key" ? undefined : args.target);
    const reason = commitReason(tool, args, info);
    const violation = ruleCheck(rules, tool, args, info, Boolean(reason));
    if (violation) return blockForRule(violation);
    const state = readTurnState(stateFile);
    const verdict = decide(state, reason, info ?? { ...UNKNOWN_ELEMENT, name: String(args.element ?? "") });
    if (verdict.kind === "pass") return toChild(message);
    if (verdict.kind === "block") return toBrain(textResult(message.id, verdict.reason));
    const answer = await askOwner(verdict, state).catch((error: Error) => ({ approved: false, text: error.message, requestId: undefined }));
    if (!answer.approved) {
      return toBrain(textResult(message.id, `blocked: needs approval. The owner did not approve "${verdict.summary}" (${answer.text}). Do not try another way; stop and report.`));
    }
    const suffix = ` (approved by the owner${answer.requestId ? ` [requestId: ${answer.requestId}]` : ""})`;
    pendingResults.set(message.id!, (reply) => {
      if (reply.result?.content?.[0]?.type === "text") reply.result.content[0].text += suffix;
      return reply;
    });
    toChild(message);
  };

  createInterface({ input: child.stdout }).on("line", (line) => {
    let message: Rpc;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message.id === "string" && own.has(message.id)) {
      own.get(message.id)!(message);
      own.delete(message.id);
      return;
    }
    if (message.result?.tools) message.result.tools = message.result.tools.filter((tool: { name: string }) => !HIDDEN_TOOLS.has(tool.name));
    const hook = message.id !== undefined ? pendingResults.get(message.id) : undefined;
    if (hook) {
      pendingResults.delete(message.id!);
      message = hook(message);
    }
    const list = secrets();
    if (!list.length) return toBrain(message);
    try {
      toBrain(JSON.parse(redactSecrets(JSON.stringify(message), list)));
    } catch {
      if (message.id !== undefined) toBrain(textResult(message.id, "The result was withheld because it could not be cleaned of saved secrets."));
    }
  });

  createInterface({ input: process.stdin }).on("line", (line) => {
    let message: Rpc;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method === "tools/call") {
      void guarded(message).catch((error: Error) => toBrain(textResult(message.id, `blocked: ${error.message}`)));
      return;
    }
    toChild(message);
  });

  process.stdin.on("end", () => child.kill());
  child.on("exit", (code) => process.exit(code ?? 0));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  void serve();
}
