import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { readSetting, writeSettingIfMissing } from "@/lib/app-settings";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";

export type PushPayload = { title: string; body: string; url: string; tag?: string };

let keys: Promise<{ publicKey: string; privateKey: string }> | null = null;

export function vapidKeys() {
  keys ??= (async () => {
    const stored = await readSetting("vapid", ["privateKey"]);
    if (stored?.publicKey && stored.privateKey) return { publicKey: stored.publicKey, privateKey: stored.privateKey };
    const fresh = webpush.generateVAPIDKeys();
    await writeSettingIfMissing("vapid", { publicKey: fresh.publicKey, privateKey: fresh.privateKey }, ["privateKey"]);
    const winner = await readSetting("vapid", ["privateKey"]);
    if (!winner?.publicKey || !winner.privateKey) throw new Error("vapid_keys_unavailable");
    return { publicKey: winner.publicKey, privateKey: winner.privateKey };
  })().catch((error) => {
    keys = null;
    throw error;
  });
  return keys;
}

function subject() {
  return env.publicUrl.startsWith("https://") ? env.publicUrl : "mailto:understudy@localhost";
}

export async function saveSubscription(userId: string, input: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
  const endpoint = String(input.endpoint ?? "");
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) throw new Error("invalid_endpoint");
  const p256dh = String(input.keys?.p256dh ?? "").slice(0, 200);
  const auth = String(input.keys?.auth ?? "").slice(0, 100);
  if (!p256dh || !auth) throw new Error("invalid_keys");
  await getDb()
    .insert(schema.pushSubscriptions)
    .values({ id: newId("push"), userId, endpoint, p256dh, auth, userAgent: userAgent?.slice(0, 300) ?? null })
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { userId, p256dh, auth } });
}

export async function removeSubscription(userId: string, endpoint: string) {
  const db = getDb();
  const rows = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint));
  if (rows[0]?.userId !== userId) return;
  await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint));
}

export async function sendPush(userIds: string[], payload: PushPayload) {
  if (userIds.length === 0) return;
  const db = getDb();
  const subscriptions = await db.select().from(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.userId, [...new Set(userIds)]));
  if (subscriptions.length === 0) return;
  const { publicKey, privateKey } = await vapidKeys();
  const body = JSON.stringify(payload);
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, {
          vapidDetails: { subject: subject(), publicKey, privateKey },
          TTL: 24 * 60 * 60,
          urgency: "high",
          topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id));
          return;
        }
        console.error(JSON.stringify({ event: "push_failed", status, error: String((error as Error).message ?? error) }));
      }
    }),
  );
}
