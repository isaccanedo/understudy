import { inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PairThread } from "@/components/rooms/PairThread";
import { agentAccess, canApprove } from "@/lib/access";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { loadPair } from "@/server/pair-threads";

export default async function PairPage({ params }: { params: Promise<{ a: string; b: string }> }) {
  const { a, b } = await params;
  if (a === b) notFound();
  const user = await requireUser();
  const [access, agents] = await Promise.all([
    Promise.all([agentAccess(user.id, a), agentAccess(user.id, b)]),
    getDb()
      .select({ id: schema.agents.id, name: schema.agents.name, role: schema.agents.role, look: schema.agents.look, state: schema.agents.state, ownerId: schema.agents.ownerId })
      .from(schema.agents)
      .where(inArray(schema.agents.id, [a, b])),
  ]);
  const pair = [a, b].map((id) => agents.find((agent) => agent.id === id));
  if (!pair[0] || !pair[1] || (!access[0] && !access[1])) notFound();
  const { rows, stopped } = await loadPair(a, b);
  const both = pair.every((agent) => agent?.ownerId === user.id);
  return (
    <PairThread
      agents={pair.map((agent, index) => ({ id: agent!.id, name: agent!.name, role: agent!.role ?? "", look: agent!.look, state: agent!.state, open: Boolean(access[index]) }))}
      entries={rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        agentId: row.fromAgentId,
        text: row.text,
        task: row.task,
        runId: row.runId,
        delivered: row.delivered,
        at: row.createdAt.toISOString(),
      }))}
      stopped={stopped}
      canStop={canApprove(access[0]) || canApprove(access[1])}
      roomHref={both ? `/rooms?with=${encodeURIComponent(`${a},${b}`)}` : null}
      ceiling={env.agentTalkCeiling}
    />
  );
}
