import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { pastCeiling } from "@/lib/agent-talk";
import { getDb, schema } from "@/lib/db";
import type { AgentMessageKind } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import type { Hub } from "./hub";
import { pairStopped } from "./pair-threads";

export const TALK_KINDS: AgentMessageKind[] = ["message", "handoff"];

export const TEAM_LIMITS = { conversationWindowMs: 30 * 60 * 1000 } as const;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

type AgentRow = typeof schema.agents.$inferSelect;

export type TeamTool = {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (args: never) => Promise<ToolResult>;
};

export type Teammate = { id: string; name: string; role: string; tasks: { id: string; title: string }[] };

const reply = (text: string, isError = false): ToolResult => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

export function limitRefusal(input: { depth: number; ceiling: number | null; stopped: boolean; teammate: string }): string | null {
  if (input.stopped) {
    return `refused: your owner stopped the conversation between you and ${input.teammate}; do not message them again until your owner lets you, and tell your owner what is left.`;
  }
  if (pastCeiling(input.depth, input.ceiling)) {
    return `refused: this conversation between agents is already ${input.ceiling} messages deep, the most this server allows; stop here and tell your owner what is left.`;
  }
  return null;
}

export function pickTeammate<T extends { id: string; name: string }>(teammates: T[], wanted: string): T | null {
  const key = wanted.trim().toLowerCase();
  return teammates.find((mate) => mate.id === wanted.trim()) ?? teammates.find((mate) => mate.name.trim().toLowerCase() === key) ?? null;
}

export function pickTask(tasks: { id: string; title: string }[], wanted: string): { id: string; title: string } | null {
  const key = wanted.trim().toLowerCase();
  return tasks.find((task) => task.id === wanted.trim()) ?? tasks.find((task) => task.title.trim().toLowerCase() === key) ?? null;
}

export async function listTeammates(agent: Pick<AgentRow, "id" | "ownerId">): Promise<Teammate[]> {
  const db = getDb();
  const agents = await db
    .select({ id: schema.agents.id, name: schema.agents.name, role: schema.agents.role })
    .from(schema.agents)
    .where(and(ne(schema.agents.id, agent.id), eq(schema.agents.ownerId, agent.ownerId)));
  if (!agents.length) return [];
  const recipes = await db
    .select({ id: schema.recipes.id, agentId: schema.recipes.agentId, recipe: schema.recipes.recipe })
    .from(schema.recipes)
    .where(inArray(schema.recipes.agentId, agents.map((row) => row.id)));
  return agents.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role ?? "",
    tasks: recipes.filter((recipe) => recipe.agentId === row.id).map((recipe) => ({ id: recipe.id, title: recipe.recipe.title })),
  }));
}

export async function conversationDepth(agentId: string, now = Date.now()): Promise<number> {
  const [latest] = await getDb()
    .select({ depth: schema.agentMessages.depth })
    .from(schema.agentMessages)
    .where(and(eq(schema.agentMessages.toAgentId, agentId), inArray(schema.agentMessages.kind, TALK_KINDS), gte(schema.agentMessages.createdAt, new Date(now - TEAM_LIMITS.conversationWindowMs))))
    .orderBy(desc(schema.agentMessages.createdAt))
    .limit(1);
  return (latest?.depth ?? 0) + 1;
}

export function teamTools(hub: Hub, agent: AgentRow): TeamTool[] {
  const guard = async (to: Teammate) => {
    const depth = await conversationDepth(agent.id);
    const refusal = limitRefusal({ depth, ceiling: env.agentTalkCeiling, stopped: await pairStopped(agent.id, to.id), teammate: to.name });
    return { depth, refusal };
  };

  return [
    {
      name: "list_teammates",
      description: "List the other understudies you may work with (same owner, or shared with your owner), with their role and the tasks they know.",
      schema: z.object({}),
      run: (async () => {
        const mates = await listTeammates(agent);
        if (!mates.length) return reply("You have no teammates yet.");
        return reply(JSON.stringify(mates.map((mate) => ({ name: mate.name, role: mate.role, tasks: mate.tasks.map((task) => task.title) }))));
      }) as TeamTool["run"],
    },
    {
      name: "message_agent",
      description: "Send a short message to a teammate (by name). It reaches them as a chat turn marked as coming from you. Use it to ask or tell them something the work needs; keep it brief.",
      schema: z.object({ agent: z.string().min(1).max(200), text: z.string().min(1).max(2000) }),
      run: (async (args: { agent: string; text: string }) => {
        const to = pickTeammate(await listTeammates(agent), args.agent);
        if (!to) return reply(`unknown teammate "${args.agent}"; call list_teammates`, true);
        const { depth, refusal } = await guard(to);
        if (refusal) return reply(refusal, true);
        const delivered = (await hub.deliver(to.id, { type: "chat", text: args.text, from: agent.name, fromAgent: { id: agent.id, name: agent.name } }, { source: "team" })).status === "sent";
        await getDb()
          .insert(schema.agentMessages)
          .values({ id: newId("amsg"), fromAgentId: agent.id, toAgentId: to.id, kind: "message", text: args.text, depth, delivered });
        await hub.addMessage(to.id, "system", `${agent.name}: ${args.text}`);
        return reply(delivered ? `delivered to ${to.name}` : `${to.name}'s computer is reconnecting; the message is queued and reaches them as soon as it is back (up to 30 minutes)`);
      }) as TeamTool["run"],
    },
    {
      name: "hand_off",
      description:
        "Start one of a teammate's own tasks (by its title, see list_teammates) with some input for it. The input reaches them as quoted data, and their owner still approves anything irreversible.",
      schema: z.object({ agent: z.string().min(1).max(200), task: z.string().min(1).max(300), input: z.string().max(20000) }),
      run: (async (args: { agent: string; task: string; input: string }) => {
        const to = pickTeammate(await listTeammates(agent), args.agent);
        if (!to) return reply(`unknown teammate "${args.agent}"; call list_teammates`, true);
        const task = pickTask(to.tasks, args.task);
        if (!task) return reply(`${to.name} has no task called "${args.task}"; their tasks: ${to.tasks.map((t) => t.title).join(", ") || "none"}`, true);
        const { depth, refusal } = await guard(to);
        if (refusal) return reply(refusal, true);
        const started = await hub.startRun(task.id, "handoff", { input: `From ${agent.name}: ${args.input}` });
        const runId = "runId" in started ? (started.runId as string | undefined) : undefined;
        await getDb()
          .insert(schema.agentMessages)
          .values({ id: newId("amsg"), fromAgentId: agent.id, toAgentId: to.id, kind: "handoff", text: args.input, task: task.title, runId: runId ?? null, depth, delivered: started.ok });
        return reply(started.ok ? `${to.name} started "${task.title}"` : `could not start "${task.title}" for ${to.name}: ${"reason" in started ? started.reason : "unknown"}`, !started.ok);
      }) as TeamTool["run"],
    },
  ];
}
