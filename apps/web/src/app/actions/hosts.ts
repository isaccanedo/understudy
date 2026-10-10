"use server";

import { revalidatePath } from "next/cache";
import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { getHub } from "@/server/hub-access";
import { removeStaleHost } from "@/server/host-removal";

export async function trustHost(hostId: string) {
  const admin = await requireAdmin();
  await getDb().update(schema.hosts).set({ trusted: true }).where(eq(schema.hosts.id, hostId));
  console.log(JSON.stringify({ event: "host_trusted", hostId, by: admin.id }));
  revalidatePath("/admin");
}

export async function forgetHost(hostId: string) {
  const admin = await requireAdmin();
  const db = getDb();
  await db.update(schema.hosts).set({ trusted: false }).where(eq(schema.hosts.id, hostId));
  const released = await db.update(schema.agents).set({ hostId: null, updatedAt: new Date() }).where(eq(schema.agents.hostId, hostId)).returning({ id: schema.agents.id });
  getHub()?.hosts.disconnect(hostId);
  console.log(JSON.stringify({ event: "host_forgotten", hostId, released: released.length, by: admin.id }));
  revalidatePath("/admin");
}

export async function removeHost(hostId: string) {
  const db = getDb();
  const result = await removeStaleHost(
    {
      requireAdmin,
      hostExists: async (id) => (await db.select({ id: schema.hosts.id }).from(schema.hosts).where(eq(schema.hosts.id, id))).length > 0,
      isConnected: (id) => (getHub()?.stats().hosts ?? []).some((host) => host.hostId === id),
      boundAgents: async (id) => (await db.select({ n: count() }).from(schema.agents).where(eq(schema.agents.hostId, id)))[0]?.n ?? 0,
      deleteHost: async (id) => {
        await db.delete(schema.hosts).where(eq(schema.hosts.id, id));
      },
      log: (line) => console.log(line),
    },
    hostId,
  );
  revalidatePath("/admin");
  return result;
}
