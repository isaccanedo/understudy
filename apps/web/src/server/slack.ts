import { readSetting } from "@/lib/app-settings";
import { env } from "@/lib/env";
import { linkedSlackUser } from "./slack-link";

type SlackResponse = { ok: boolean; error?: string; [key: string]: unknown };

export type SlackConfig = { botToken: string; signingSecret?: string; source: "panel" | "env"; teamName?: string; botUserId?: string };

export type SlackIdentity = { username: string; iconUrl: string };

export const SLACK_SECRET_FIELDS = ["botToken", "signingSecret"];

const CONFIG_TTL_MS = 30_000;
let cached: { at: number; value: SlackConfig | null } | null = null;
const userIdByEmail = new Map<string, string>();
const emailByUserId = new Map<string, { email: string | null; at: number }>();

export async function slackConfig(): Promise<SlackConfig | null> {
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.value;
  let value: SlackConfig | null = null;
  try {
    const stored = await readSetting("slack", SLACK_SECRET_FIELDS);
    if (stored?.botToken) {
      value = { botToken: stored.botToken, signingSecret: stored.signingSecret || undefined, source: "panel", teamName: stored.teamName, botUserId: stored.botUserId };
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "slack_config_error", error: String(error) }));
  }
  if (!value && env.slackBotToken) {
    value = { botToken: env.slackBotToken, signingSecret: process.env.SLACK_SIGNING_SECRET?.trim() || undefined, source: "env" };
  }
  cached = { at: Date.now(), value };
  return value;
}

export function forgetSlackConfig() {
  cached = null;
  userIdByEmail.clear();
  emailByUserId.clear();
}

export function slackApiBase() {
  return (process.env.SLACK_API_BASE_URL?.trim() || "https://slack.com/api").replace(/\/$/, "");
}

export async function grantedSlackScopes(): Promise<string[] | null> {
  const botToken = (await slackConfig())?.botToken;
  if (!botToken) return null;
  try {
    const res = await fetch(`${slackApiBase()}/auth.test`, { method: "POST", headers: { Authorization: `Bearer ${botToken}` } });
    const data = (await res.json()) as SlackResponse;
    if (!data.ok) return null;
    return (res.headers.get("x-oauth-scopes") ?? "").split(",").map((scope) => scope.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

export async function slackCall(method: string, body: Record<string, unknown>, token?: string): Promise<SlackResponse> {
  const botToken = token ?? (await slackConfig())?.botToken;
  if (!botToken) return { ok: false, error: "slack_disabled" };
  const res = await fetch(`${slackApiBase()}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as SlackResponse;
  if (!data.ok) console.error(JSON.stringify({ event: "slack_call_failed", method, error: data.error }));
  return data;
}

async function slackGet(method: string, params: Record<string, string>) {
  const botToken = (await slackConfig())?.botToken;
  if (!botToken) return { ok: false, error: "slack_disabled" } as SlackResponse;
  const res = await fetch(`${slackApiBase()}/${method}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${botToken}` } });
  return (await res.json()) as SlackResponse;
}

async function lookupUserId(rawEmail: string): Promise<string | null> {
  const email = rawEmail.trim().toLowerCase();
  const cachedId = userIdByEmail.get(email);
  if (cachedId) return cachedId;
  const data = (await slackGet("users.lookupByEmail", { email })) as SlackResponse & { user?: { id: string } };
  if (!data.ok || !data.user) return null;
  userIdByEmail.set(email, data.user.id);
  return data.user.id;
}

export type SlackRecipient = { id: string; email: string };

export async function slackUserIdFor(person: SlackRecipient): Promise<string | null> {
  const linked = await linkedSlackUser(person.id).catch((error) => {
    console.error(JSON.stringify({ event: "slack_link_read_failed", error: String(error) }));
    return null;
  });
  return linked ?? (await lookupUserId(person.email));
}

export async function slackUserName(slackUserId: string): Promise<string | null> {
  const data = (await slackGet("users.info", { user: slackUserId })) as SlackResponse & { user?: { name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string } } };
  if (!data.ok || !data.user) return null;
  return data.user.profile?.display_name || data.user.profile?.real_name || data.user.real_name || data.user.name || null;
}

export async function slackUserEmail(slackUserId: string): Promise<string | null> {
  const hit = emailByUserId.get(slackUserId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.email;
  const data = (await slackGet("users.info", { user: slackUserId })) as SlackResponse & { user?: { deleted?: boolean; is_bot?: boolean; profile?: { email?: string } } };
  const email = data.ok && data.user && !data.user.deleted && !data.user.is_bot ? data.user.profile?.email?.trim().toLowerCase() || null : null;
  emailByUserId.set(slackUserId, { email, at: Date.now() });
  return email;
}

export function escapeSlack(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function slackEnabled() {
  return Boolean(await slackConfig());
}

export async function slackInteractive() {
  return Boolean((await slackConfig())?.signingSecret);
}

export function agentIdentity(agent: { id: string; name: string }): SlackIdentity {
  return { username: agent.name.slice(0, 80), iconUrl: `${env.publicUrl}/api/agents/${agent.id}/avatar.png` };
}

function identityFields(as?: SlackIdentity) {
  return as ? { username: as.username, icon_url: as.iconUrl } : {};
}

export async function sendDirectMessage(to: SlackRecipient, text: string, blocks?: unknown[], as?: SlackIdentity) {
  if (!(await slackEnabled())) return { ok: false, error: "slack_disabled" };
  const userId = await slackUserIdFor(to);
  if (!userId) return { ok: false, error: "user_not_found" };
  return slackCall("chat.postMessage", { channel: userId, text, blocks, unfurl_links: false, ...identityFields(as) });
}

export async function postMessage(input: { channel: string; text: string; threadTs?: string; blocks?: unknown[]; as?: SlackIdentity }) {
  return slackCall("chat.postMessage", {
    channel: input.channel,
    text: input.text,
    blocks: input.blocks,
    thread_ts: input.threadTs,
    unfurl_links: false,
    ...identityFields(input.as),
  });
}

export function normalizeChannel(channel: string) {
  return channel.trim().replace(/^#/, "").toLowerCase();
}
