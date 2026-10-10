"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import type { Brain } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import { hashToken, newComputerToken, newId } from "@/lib/ids";
import { messages } from "@/lib/messages";
import { effectiveModel, isModel } from "@/lib/models";
import { requireUser } from "@/lib/session";
import { removeAgentArtifactBlobs } from "@/server/artifacts/service";
import { getHub } from "@/server/hub-access";
import { cleanRules } from "@/server/rules";
import { computerProfile } from "@/server/computer-profile";
import { cleanLook, type Look } from "@/lib/look";
import { agentTabPath } from "@/lib/workspace-tabs";
import { toolsFrom, parseLook, ownAgent } from "./shared";

export async function createAgent(_: { error?: string; redirectTo?: string } | null, form: FormData) {
  const user = await requireUser();
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: messages.create.nameRequired };
  const role = String(form.get("role") ?? "").trim().slice(0, 200);
  const look = parseLook(form);
  const brain: Brain = "claude";
  const id = newId("agt");
  await getDb()
    .insert(schema.agents)
    .values({
      id,
      ownerId: user.id,
      name,
      role,
      look,
      brain,
      tokenHash: hashToken(newComputerToken()),
      tools: await toolsFrom(form, user.email),
    });
  await getHub()?.ensureComputer(id);
  return { redirectTo: agentTabPath(id, "settings") };
}

export async function updateAgentTools(agentId: string, form: FormData) {
  const { user } = await ownAgent(agentId);
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const role = String(form.get("role") ?? "").trim().slice(0, 200);
  const look = parseLook(form);
  await getDb()
    .update(schema.agents)
    .set({
      ...(name ? { name } : {}),
      role,
      look,
      tools: await toolsFrom(form, user.email),
      updatedAt: new Date(),
    })
    .where(eq(schema.agents.id, agentId));
  const profile = await computerProfile(agentId);
  if (profile) getHub()?.sendToComputer(agentId, profile);
  revalidatePath(`/agents/${agentId}`, "layout");
}

export async function updateAgentLook(agentId: string, look: unknown) {
  await ownAgent(agentId);
  await getDb()
    .update(schema.agents)
    .set({ look: cleanLook(look as Partial<Look> | null), updatedAt: new Date() })
    .where(eq(schema.agents.id, agentId));
  const profile = await computerProfile(agentId);
  if (profile) getHub()?.sendToComputer(agentId, profile);
  revalidatePath(`/agents/${agentId}`, "layout");
}

export async function restartComputer(agentId: string) {
  await ownAgent(agentId);
  const ok = await getHub()?.ensureComputer(agentId);
  revalidatePath(`/agents/${agentId}`, "layout");
  return { ok: Boolean(ok) };
}

export async function deleteAgent(agentId: string) {
  await ownAgent(agentId);
  getHub()?.stopComputer(agentId, true);
  getHub()?.closeViewers((id) => id === agentId);
  getHub()?.closeComputer(agentId);
  await removeAgentArtifactBlobs(agentId).catch((error) => console.error("artifact_cleanup_failed", { agentId, error: String(error) }));
  await getDb().delete(schema.agents).where(eq(schema.agents.id, agentId));
  return { redirectTo: "/" };
}

export async function addAgentMember(agentId: string, _: { ok?: boolean; message?: string } | null, form: FormData) {
  const { user } = await ownAgent(agentId);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = form.get("role") === "viewer" ? "viewer" : "approver";
  const db = getDb();
  const [member] = await db.select({ id: schema.user.id, status: schema.user.status }).from(schema.user).where(eq(schema.user.email, email));
  if (!member || member.status !== "approved") return { ok: false, message: messages.share.notFound };
  if (member.id === user.id) return { ok: false, message: messages.share.self };
  await db
    .insert(schema.agentMembers)
    .values({ agentId, userId: member.id, role })
    .onConflictDoUpdate({ target: [schema.agentMembers.agentId, schema.agentMembers.userId], set: { role } });
  revalidatePath(`/agents/${agentId}`);
  return { ok: true, message: messages.share.added(email) };
}

export async function removeAgentMember(agentId: string, userId: string) {
  await ownAgent(agentId);
  getHub()?.closeViewers((id, viewer) => id === agentId && viewer.userId === userId);
  await getDb()
    .delete(schema.agentMembers)
    .where(and(eq(schema.agentMembers.agentId, agentId), eq(schema.agentMembers.userId, userId)));
  revalidatePath(`/agents/${agentId}`);
}

export async function setAgentModel(agentId: string, model: string) {
  const { agent } = await ownAgent(agentId);
  const chosen = isModel(model) ? model : null;
  await getDb().update(schema.agents).set({ model: chosen, updatedAt: new Date() }).where(eq(schema.agents.id, agent.id));
  const effective = effectiveModel(chosen);
  getHub()?.sendToComputer(agent.id, { type: "set_model", model: effective ?? "" });
  revalidatePath(`/agents/${agent.id}`, "layout");
  revalidatePath("/settings");
  return { model: chosen };
}

export async function setAgentRules(agentId: string, input: unknown) {
  const { agent } = await ownAgent(agentId);
  const rules = cleanRules(input);
  if (!rules) return { ok: false as const };
  await getDb().update(schema.agents).set({ rules, updatedAt: new Date() }).where(eq(schema.agents.id, agent.id));
  getHub()?.sendToComputer(agent.id, { type: "set_rules", rules });
  revalidatePath(`/agents/${agent.id}`, "layout");
  return { ok: true as const, rules };
}
