"use server";

import { headers } from "next/headers";
import { requireUser } from "@/lib/session";
import { removeSubscription, saveSubscription } from "@/server/push";

export async function subscribePush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const user = await requireUser();
  try {
    await saveSubscription(user.id, subscription, (await headers()).get("user-agent") ?? undefined);
    return { ok: true };
  } catch (error) {
    console.error(JSON.stringify({ event: "push_subscribe_failed", userId: user.id, error: String(error) }));
    return { ok: false };
  }
}

export async function unsubscribePush(endpoint: string) {
  const user = await requireUser();
  await removeSubscription(user.id, String(endpoint ?? ""));
  return { ok: true };
}
