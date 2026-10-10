import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { AgentInside } from "@/components/inside/AgentInside";
import type { OwnerData } from "@/components/workspace/AgentWorkspace";
import type { RailData } from "@/components/inside/AgentRail";
import { accessibleAgentIds } from "@/lib/access";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { CHAT_WIDTH_COOKIE, WORKSPACE_HIDDEN_COOKIE, parseStoredWidth } from "@/lib/chat-layout";
import { formatWhen } from "@/lib/format";
import { messages } from "@/lib/messages";
import { defaultModel } from "@/lib/models";
import { serverOptions } from "@/lib/server-options";
import { requireAgentAccess } from "@/lib/session";
import { loadChat, loadPendingApprovals, loadRuns } from "@/lib/views";
import { slackEnabled } from "@/server/slack";

type Agent = typeof schema.agents.$inferSelect;

async function loadOwnerData(agent: Agent, email: string, admin: boolean): Promise<OwnerData> {
  const db = getDb();
  const [files, memory, members, slackAvailable, servers] = await Promise.all([
    db.select().from(schema.agentFiles).where(eq(schema.agentFiles.agentId, agent.id)).orderBy(asc(schema.agentFiles.path)),
    db.select().from(schema.memoryFiles).where(eq(schema.memoryFiles.agentId, agent.id)).orderBy(asc(schema.memoryFiles.path)),
    db
      .select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.agentMembers.role })
      .from(schema.agentMembers)
      .innerJoin(schema.user, eq(schema.user.id, schema.agentMembers.userId))
      .where(eq(schema.agentMembers.agentId, agent.id)),
    slackEnabled(),
    serverOptions({ id: agent.ownerId, email }),
  ]);
  return {
    files: files.map((f) => ({ path: f.path, size: f.size, updatedAt: f.updatedAt.getTime() })),
    memory: memory.map((f) => ({ path: f.path, text: f.text, updatedAt: f.updatedAt.getTime() })),
    credentials: agent.credentials,
    settings: {
      values: { id: agent.id, name: agent.name, role: agent.role, look: agent.look, brain: agent.brain, tools: agent.tools },
      slackAvailable,
      servers,
      admin,
      model: agent.model,
      serverDefaultModel: defaultModel(),
      rules: agent.rules ?? [],
      members,
    },
  };
}

async function loadWaitingRuns(runIds: string[]) {
  if (runIds.length === 0) return new Set<string>();
  const rows = await getDb()
    .select({ runId: schema.approvals.runId })
    .from(schema.approvals)
    .where(and(inArray(schema.approvals.runId, runIds), eq(schema.approvals.status, "pending")));
  return new Set(rows.map((row) => row.runId));
}

async function loadRail(userId: string, userName: string): Promise<RailData> {
  const db = getDb();
  const [visible, answerable] = await Promise.all([accessibleAgentIds(userId), accessibleAgentIds(userId, ["owner", "approver"])]);
  const [agents, pending] = await Promise.all([
    visible.length
      ? db
          .select({ id: schema.agents.id, name: schema.agents.name, look: schema.agents.look, state: schema.agents.state, note: schema.agents.stateNote })
          .from(schema.agents)
          .where(inArray(schema.agents.id, visible))
          .orderBy(asc(schema.agents.name))
      : [],
    answerable.length
      ? db
          .select({ agentId: schema.approvals.agentId })
          .from(schema.approvals)
          .where(and(inArray(schema.approvals.agentId, answerable), eq(schema.approvals.status, "pending")))
      : [],
  ]);
  const waitingBy = new Map<string, number>();
  for (const row of pending) waitingBy.set(row.agentId, (waitingBy.get(row.agentId) ?? 0) + 1);
  return {
    agents: agents.map((agent) => ({ ...agent, waiting: waitingBy.get(agent.id) ?? 0 })),
    waiting: pending.length,
    userName,
    productName: env.productName,
  };
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, agent, access } = await requireAgentAccess(id);
  const jar = await cookies();
  const chatWidth = parseStoredWidth(jar.get(CHAT_WIDTH_COOKIE)?.value ?? null);
  const workspaceHidden = jar.get(WORKSPACE_HIDDEN_COOKIE)?.value === "1";
  const db = getDb();
  const [[owner], chat, approvals, runs, recipes, ownerData, rail] = await Promise.all([
    db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, agent.ownerId)),
    loadChat(id),
    loadPendingApprovals(id),
    loadRuns(id, 20),
    db
      .select({ id: schema.recipes.id, title: schema.recipes.recipe, active: schema.recipes.active })
      .from(schema.recipes)
      .where(eq(schema.recipes.agentId, id))
      .orderBy(desc(schema.recipes.updatedAt)),
    access === "owner" ? loadOwnerData(agent, user.email, Boolean(user.admin)) : null,
    loadRail(user.id, user.name || user.email),
  ]);
  const waiting = await loadWaitingRuns(runs.map((r) => r.id));
  const recipeTitles = new Map(recipes.map((r) => [r.id, r.title.title]));
  return (
    <AgentInside
      agent={{
        id: agent.id,
        name: agent.name,
        role: agent.role ?? "",
        look: agent.look,
        brain: agent.brain,
        state: agent.state,
        note: agent.stateNote,
        computerStatus: agent.computerStatus,
        brains: agent.brains,
      }}
      ownerName={owner?.name ?? ""}
      access={access}
      initialChatWidth={chatWidth}
      initialWorkspaceHidden={workspaceHidden}
      initialChat={chat}
      initialApprovals={approvals}
      runs={runs.map((r) => ({
        id: r.id,
        when: formatWhen(r.startedAt),
        label: r.summary ?? recipeTitles.get(r.recipeId ?? "") ?? messages.recipe.runStatus[r.status] ?? r.status,
        status: r.status,
        waiting: waiting.has(r.id),
      }))}
      recipes={recipes.map((r) => ({ id: r.id, title: r.title.title, active: r.active }))}
      ownerData={ownerData}
      rail={rail}
    />
  );
}
