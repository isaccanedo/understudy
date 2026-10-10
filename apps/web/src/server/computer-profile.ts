import { eq } from "drizzle-orm";
import type { ServerToComputer } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import { cleanLook } from "@/lib/look";

export async function computerProfile(agentId: string): Promise<Extract<ServerToComputer, { type: "profile" }> | null> {
  const [row] = await getDb()
    .select({ name: schema.agents.name, look: schema.agents.look, ownerName: schema.user.name })
    .from(schema.agents)
    .leftJoin(schema.user, eq(schema.user.id, schema.agents.ownerId))
    .where(eq(schema.agents.id, agentId));
  if (!row) return null;
  const ownerName = row.ownerName?.trim().split(/\s+/)[0]?.slice(0, 100);
  return { type: "profile", name: row.name.slice(0, 100), ...(ownerName ? { ownerName } : {}), look: cleanLook(row.look) };
}
