import { and, eq, sql } from "drizzle-orm";
import { areaPath } from "@understudy/protocol";
import type { Access } from "@/lib/access";
import { getDb, schema } from "@/lib/db";

export function canUpload(access: Access | null) {
  return access === "owner";
}

export function canRead(access: Access | null, path: string, attachedToChat: boolean) {
  if (!access || !areaPath(path)) return false;
  if (access === "owner") return true;
  return attachedToChat;
}

export async function attachedToChat(agentId: string, path: string) {
  const [row] = await getDb()
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.agentId, agentId), sql`${schema.messages.attachments} @> ${JSON.stringify([{ path }])}::jsonb`))
    .limit(1);
  return Boolean(row);
}
