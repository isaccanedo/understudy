"use server";

import { requireUser } from "@/lib/session";
import { createPairCode, listExtensionTokens, revokeExtensionToken } from "@/server/extension/pairing";

export type ConnectedBrowser = { id: string; label: string; createdAt: string; lastUsedAt: string };

export async function connectedBrowsers(): Promise<ConnectedBrowser[]> {
  const user = await requireUser();
  const tokens = await listExtensionTokens(user.id);
  return tokens.map((token) => ({ id: token.id, label: token.label, createdAt: token.createdAt.toISOString(), lastUsedAt: token.lastUsedAt.toISOString() }));
}

export async function showPairCode() {
  const user = await requireUser();
  const { code, expiresAt } = await createPairCode(user.id);
  return { code, expiresAt: expiresAt.toISOString() };
}

export async function disconnectBrowser(id: string) {
  const user = await requireUser();
  await revokeExtensionToken(user.id, String(id));
  return connectedBrowsers();
}
