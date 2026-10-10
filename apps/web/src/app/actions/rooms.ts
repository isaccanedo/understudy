"use server";

import { revalidatePath } from "next/cache";
import { agentAccess, canApprove } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { getHub } from "@/server/hub-access";
import { setPairStopped } from "@/server/pair-threads";
import { createRoom, deleteOwnedRoom } from "@/server/room-store";

export async function openRoom(input: { name: string; agentIds: string[] }) {
  const user = await requireUser();
  const result = await createRoom(user.id, { name: input?.name, agentIds: Array.isArray(input?.agentIds) ? input.agentIds : [] });
  if (result.ok) revalidatePath("/rooms");
  return result;
}

export async function removeRoom(roomId: string) {
  const user = await requireUser();
  const deleted = await deleteOwnedRoom(user.id, String(roomId ?? ""));
  if (deleted) {
    getHub()?.rooms.closeViewers(roomId);
    revalidatePath("/rooms");
  }
  return { ok: deleted };
}

export async function setPairTalk(input: { a: string; b: string; stopped: boolean }) {
  const user = await requireUser();
  const a = String(input?.a ?? "");
  const b = String(input?.b ?? "");
  if (!a || !b || a === b) return { ok: false };
  const [left, right] = await Promise.all([agentAccess(user.id, a), agentAccess(user.id, b)]);
  if (!left || !right || (!canApprove(left) && !canApprove(right))) return { ok: false };
  await setPairStopped(a, b, Boolean(input.stopped));
  revalidatePath("/rooms");
  return { ok: true };
}
