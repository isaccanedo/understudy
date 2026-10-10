import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "./db";
import { isAdmin } from "./env";

export type Access = "owner" | "approver" | "viewer";

async function readsEveryAgent(userId: string) {
  const [row] = await getDb()
    .select({ email: schema.user.email, admin: schema.user.admin, source: schema.user.source, status: schema.user.status })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return Boolean(row && row.status === "approved" && isAdmin(row.email, row.admin, row.source));
}

export async function agentAccess(userId: string, agentId: string): Promise<Access | null> {
  const db = getDb();
  const [agent] = await db.select({ ownerId: schema.agents.ownerId }).from(schema.agents).where(eq(schema.agents.id, agentId));
  if (!agent) return null;
  if (agent.ownerId === userId) return "owner";
  const [member] = await db
    .select({ role: schema.agentMembers.role })
    .from(schema.agentMembers)
    .where(and(eq(schema.agentMembers.agentId, agentId), eq(schema.agentMembers.userId, userId)));
  if (member) return member.role;
  return (await readsEveryAgent(userId)) ? "viewer" : null;
}

export async function accessibleAgentIds(userId: string, roles: Access[] = ["owner", "approver", "viewer"]) {
  const db = getDb();
  const ids = new Set<string>();
  if (roles.includes("viewer") && (await readsEveryAgent(userId))) {
    for (const a of await db.select({ id: schema.agents.id }).from(schema.agents)) ids.add(a.id);
    return [...ids];
  }
  if (roles.includes("owner")) {
    for (const a of await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.ownerId, userId))) ids.add(a.id);
  }
  const memberRoles = roles.filter((r): r is "approver" | "viewer" => r !== "owner");
  if (memberRoles.length > 0) {
    const rows = await db
      .select({ id: schema.agentMembers.agentId })
      .from(schema.agentMembers)
      .where(and(eq(schema.agentMembers.userId, userId), inArray(schema.agentMembers.role, memberRoles)));
    for (const r of rows) ids.add(r.id);
  }
  return [...ids];
}

export function canApprove(access: Access | null) {
  return access === "owner" || access === "approver";
}
