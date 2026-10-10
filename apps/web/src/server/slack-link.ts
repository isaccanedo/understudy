import { deleteSetting, readSetting, writeSetting } from "@/lib/app-settings";
import { env } from "@/lib/env";
import { open, seal } from "@/lib/secret-box";

export const SLACK_LINK_TTL_MS = 60 * 60 * 1000;

const SLACK_USER_ID = /^[UW][A-Z0-9]{6,}$/;
const keyForUser = (userId: string) => `slack-link:user:${userId}`;
const keyForMember = (slackUserId: string) => `slack-link:member:${slackUserId}`;

export function slackLinkToken(slackUserId: string, now = Date.now()) {
  return seal(JSON.stringify({ purpose: "slack-link", slackUserId, exp: now + SLACK_LINK_TTL_MS }));
}

export function slackLinkUrl(slackUserId: string, now = Date.now()) {
  return `${env.publicUrl}/settings?slack=${encodeURIComponent(slackLinkToken(slackUserId, now))}#slack`;
}

export function readSlackLinkToken(token: string, now = Date.now()): string | null {
  try {
    const parsed = JSON.parse(open(token)) as { purpose?: unknown; slackUserId?: unknown; exp?: unknown };
    if (parsed.purpose !== "slack-link" || typeof parsed.slackUserId !== "string" || typeof parsed.exp !== "number") return null;
    if (!SLACK_USER_ID.test(parsed.slackUserId) || parsed.exp <= now) return null;
    return parsed.slackUserId;
  } catch {
    return null;
  }
}

export async function linkedSlackUser(userId: string): Promise<string | null> {
  return (await readSetting(keyForUser(userId)))?.slackUserId || null;
}

export async function linkedPanelUser(slackUserId: string): Promise<string | null> {
  return (await readSetting(keyForMember(slackUserId)))?.userId || null;
}

export async function linkSlackUser(userId: string, slackUserId: string) {
  const previousMember = await linkedSlackUser(userId);
  if (previousMember && previousMember !== slackUserId) await deleteSetting(keyForMember(previousMember));
  const previousUser = await linkedPanelUser(slackUserId);
  if (previousUser && previousUser !== userId) await deleteSetting(keyForUser(previousUser));
  await writeSetting(keyForUser(userId), { slackUserId });
  await writeSetting(keyForMember(slackUserId), { userId });
}

export async function unlinkSlackUser(userId: string) {
  const member = await linkedSlackUser(userId);
  if (member) await deleteSetting(keyForMember(member));
  await deleteSetting(keyForUser(userId));
}
