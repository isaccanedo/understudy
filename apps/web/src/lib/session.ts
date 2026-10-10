import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { sessionFromHeaders, type SessionUser } from "./auth";
import { agentAccess } from "./access";
import { getDb, schema } from "./db";

export async function currentUser(): Promise<SessionUser | null> {
  return sessionFromHeaders(await headers());
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (user.status !== "approved") redirect("/pending");
  if (user.mustChangePassword) redirect("/change-password");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.admin) redirect("/");
  return user;
}

export async function requireAgentAccess(agentId: string) {
  const user = await requireUser();
  const access = await agentAccess(user.id, agentId);
  if (!access) redirect("/");
  const [agent] = await getDb().select().from(schema.agents).where(eq(schema.agents.id, agentId));
  if (!agent) redirect("/");
  return { user, agent, access };
}

export async function requireOwnAgent(agentId: string) {
  const user = await requireUser();
  const [agent] = await getDb()
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, user.id)));
  if (!agent) redirect("/");
  return { user, agent };
}
