import { createHmac } from "node:crypto";
import { sameSecret } from "@/lib/secret-compare";

export const SLACK_BOT_SCOPES = [
  "chat:write",
  "chat:write.customize",
  "chat:write.public",
  "im:history",
  "im:write",
  "app_mentions:read",
  "users:read",
  "users:read.email",
  "commands",
  "channels:read",
  "groups:read",
  "channels:join",
  "channels:history",
  "groups:history",
  "files:write",
];

export function missingScopes(granted: string[]) {
  const have = new Set(granted);
  return SLACK_BOT_SCOPES.filter((scope) => !have.has(scope));
}

export function slashCommand(productName: string) {
  const slug = productName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 31);
  return `/${slug || "understudy"}`;
}

export function slackManifest(input: { productName: string; publicUrl: string; description: string }) {
  const base = input.publicUrl.replace(/\/$/, "");
  return {
    display_information: { name: input.productName.slice(0, 35), description: input.description.slice(0, 139), background_color: "#07080a" },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: input.productName.slice(0, 80), always_online: true },
      slash_commands: [{ command: slashCommand(input.productName), url: `${base}/api/slack/commands`, description: input.description.slice(0, 100), should_escape: false }],
    },
    oauth_config: { scopes: { bot: SLACK_BOT_SCOPES } },
    settings: {
      event_subscriptions: { request_url: `${base}/api/slack/events`, bot_events: ["app_mention", "message.im"] },
      interactivity: { is_enabled: true, request_url: `${base}/api/slack/interactivity` },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

export function slackManifestUrl(manifest: unknown) {
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`;
}

export function slackSignature(secret: string, timestamp: string, body: string) {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

export function verifySlackSignature(input: { secret: string; timestamp: string | undefined; signature: string | undefined; body: string; now?: number }) {
  if (!input.secret || !input.timestamp || !input.signature) return false;
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - ts) > 300) return false;
  return sameSecret(slackSignature(input.secret, input.timestamp, input.body), input.signature);
}

export function stripMentions(text: string) {
  return text.replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, "").replace(/\s+/g, " ").trim();
}

function fold(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function pickAgent<T extends { id: string; name: string }>(text: string, agents: T[]): { agent: T; text: string } | { agent: null; reason: "none" | "ambiguous" } {
  const clean = text.trim();
  const folded = fold(clean);
  const byLength = [...agents].sort((a, b) => b.name.length - a.name.length);
  for (const agent of byLength) {
    const name = fold(agent.name.trim());
    if (!name) continue;
    if (folded === name) return { agent, text: "" };
    if (folded.startsWith(name)) {
      const next = folded.charAt(name.length);
      if (/[\s,:;.!?-]/.test(next)) return { agent, text: clean.slice(agent.name.trim().length).replace(/^[\s,:;.!?-]+/, "").trim() };
    }
  }
  if (agents.length === 1) return { agent: agents[0], text: clean };
  return { agent: null, reason: agents.length === 0 ? "none" : "ambiguous" };
}
