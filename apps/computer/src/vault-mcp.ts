import { createInterface } from "node:readline";
import WebSocket from "ws";
import { CDP_ENDPOINT } from "./browser.ts";
import { hostMatches, openVault, type Vault } from "./vault.ts";

type Target = { id: string; type: string; url: string; webSocketDebuggerUrl?: string };

type Part = "username" | "secret";

export const VAULT_TOOLS = [
  {
    name: "list_credentials",
    description: "List the saved logins this agent may use (names, usernames and sites only; never secrets).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fill_credential",
    description:
      "Type a saved login into a field of the page that is open, without the value ever reaching you. part is username or secret (default secret). fieldSelector is a CSS selector or label=<visible label text>; leave it empty to pick the password field (for secret) or the field before it (for username). Refuses pages outside the credential's site.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        fieldSelector: { type: "string" },
        part: { type: "string", enum: ["username", "secret"] },
      },
      required: ["name"],
    },
  },
];

export function focusedKindScript(): string {
  return `(() => { const element = document.activeElement; if (!element || element.tagName !== "INPUT") return "other"; return (element.getAttribute("type") || "text").toLowerCase(); })()`;
}

export function fieldAccepts(part: "username" | "secret", kind: string): boolean {
  return part === "secret" ? kind === "password" : ["text", "email", "tel", "search"].includes(kind);
}

export function locateFieldScript(selector: string, part: Part): string {
  return `(() => {
  const selector = ${JSON.stringify(selector)};
  const part = ${JSON.stringify(part)};
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
  const fields = () => Array.from(document.querySelectorAll("input, textarea")).filter((e) => visible(e) && !e.disabled && !["hidden","submit","button","checkbox","radio"].includes(e.type));
  let element = null;
  if (selector.startsWith("label=")) {
    const wanted = selector.slice(6).trim().toLowerCase();
    element = fields().find((e) => {
      const texts = [e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("name"), ...(e.labels ? Array.from(e.labels).map((l) => l.textContent) : [])];
      return texts.some((t) => t && t.trim().toLowerCase().includes(wanted));
    }) || null;
  } else if (selector) {
    try { element = document.querySelector(selector); } catch { return "bad-selector"; }
  } else {
    const all = fields();
    const password = all.find((e) => e.type === "password");
    element = part === "secret" ? password || null : (password ? all[all.indexOf(password) - 1] : all.find((e) => e.type === "email" || /user|login|email/i.test(e.name || e.id))) || null;
  }
  if (!element) return "none";
  const kind = (element.tagName === "INPUT" ? (element.getAttribute("type") || "text") : "other").toLowerCase();
  if (part === "secret" && kind !== "password") return "wrong-field";
  if (part === "username" && !["text", "email", "tel", "search"].includes(kind)) return "wrong-field";
  element.scrollIntoView({ block: "center" });
  element.focus();
  if ("value" in element) { element.value = ""; element.dispatchEvent(new Event("input", { bubbles: true })); }
  return document.activeElement === element ? "focused" : "unfocusable";
})()`;
}

function cdpCall(socket: WebSocket, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString());
      if (message.id !== id) return;
      socket.off("message", onMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

export async function fillCredential(vault: Vault, args: { name?: string; fieldSelector?: string; part?: string }, endpoint = CDP_ENDPOINT): Promise<string> {
  const name = String(args.name ?? "");
  const part: Part = args.part === "username" ? "username" : "secret";
  const credential = vault.reveal(name);
  if (!credential) return `No saved login named "${name}". Ask the owner to add it in the panel.`;
  if (!credential.site) return `Refused: "${name}" has no site, and a saved login is only filled on its own site. Ask the owner to set one.`;
  const value = part === "username" ? credential.username : credential.secret;
  const targets = ((await (await fetch(`${endpoint}/json/list`)).json()) as Target[]).filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  let refusedSite = false;
  for (const target of targets) {
    if (!hostMatches(credential.site, target.url)) {
      refusedSite = true;
      continue;
    }
    const socket = await connect(target.webSocketDebuggerUrl!);
    try {
      const located = await cdpCall(socket, "Runtime.evaluate", { expression: locateFieldScript(String(args.fieldSelector ?? ""), part), returnByValue: true });
      const outcome = located?.result?.value;
      if (outcome === "bad-selector") return "That selector is not valid CSS. Use a CSS selector, label=<text>, or leave it empty.";
      if (outcome === "wrong-field") return part === "secret" ? "Refused: a password is only typed into a password field." : "Refused: a username is only typed into a text or email field.";
      if (outcome !== "focused") continue;
      const focused = await cdpCall(socket, "Runtime.evaluate", { expression: focusedKindScript(), returnByValue: true });
      if (!fieldAccepts(part, String(focused?.result?.value ?? ""))) return "Refused: the field changed before the value could be typed.";
      await cdpCall(socket, "Input.insertText", { text: value });
      return `Filled the ${part} of "${name}" into the field.`;
    } finally {
      socket.close();
    }
  }
  if (refusedSite) return `Refused: "${name}" is only for ${credential.site}, and no open page on that site has the field.`;
  return "Could not find that field on any open page.";
}

function reply(id: unknown, result: unknown) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function replyError(id: unknown, message: string) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message } })}\n`);
}

async function serve() {
  const vault = openVault(process.env.HOME || "/home/agent");
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: { id?: unknown; method?: string; params?: any };
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined) continue;
    try {
      if (message.method === "initialize") {
        reply(message.id, { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "understudy-vault", version: "1" } });
      } else if (message.method === "tools/list") {
        reply(message.id, { tools: VAULT_TOOLS });
      } else if (message.method === "ping") {
        reply(message.id, {});
      } else if (message.method === "tools/call" && message.params?.name === "list_credentials") {
        const list = vault.list().map((entry) => `${entry.name}: ${entry.username}${entry.site ? ` (${entry.site})` : ""}`);
        reply(message.id, { content: [{ type: "text", text: list.length ? list.join("\n") : "No saved logins." }] });
      } else if (message.method === "tools/call" && message.params?.name === "fill_credential") {
        const text = await fillCredential(vault, message.params.arguments ?? {});
        reply(message.id, { content: [{ type: "text", text }] });
      } else {
        replyError(message.id, `unknown method ${message.method}`);
      }
    } catch (error) {
      reply(message.id, { content: [{ type: "text", text: `Failed: ${(error as Error).message}` }], isError: true });
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  void serve();
}
