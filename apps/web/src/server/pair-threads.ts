import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { pairKey } from "@/lib/agent-talk";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/ids";

type Row = typeof schema.agentMessages.$inferSelect;

export type PairSummary = { ids: [string, string]; last: Row; stopped: boolean };

const CONTROL_KINDS = ["stop", "resume"] as const;

function between(a: string, b: string) {
  return or(
    and(eq(schema.agentMessages.fromAgentId, a), eq(schema.agentMessages.toAgentId, b)),
    and(eq(schema.agentMessages.fromAgentId, b), eq(schema.agentMessages.toAgentId, a)),
  );
}

export function isStopped(rows: Pick<Row, "kind">[]) {
  return rows.find((row) => row.kind === "stop" || row.kind === "resume")?.kind === "stop";
}

export async function pairStopped(a: string, b: string) {
  const [latest] = await getDb()
    .select({ kind: schema.agentMessages.kind })
    .from(schema.agentMessages)
    .where(and(between(a, b), inArray(schema.agentMessages.kind, [...CONTROL_KINDS])))
    .orderBy(desc(schema.agentMessages.createdAt))
    .limit(1);
  return latest?.kind === "stop";
}

export async function listPairs(agentIds: string[], limit = 500): Promise<PairSummary[]> {
  if (!agentIds.length) return [];
  const rows = await getDb()
    .select()
    .from(schema.agentMessages)
    .where(or(inArray(schema.agentMessages.fromAgentId, agentIds), inArray(schema.agentMessages.toAgentId, agentIds)))
    .orderBy(desc(schema.agentMessages.createdAt))
    .limit(limit);
  const pairs = new Map<string, Row[]>();
  for (const row of rows) {
    const key = pairKey(row.fromAgentId, row.toAgentId).join("|");
    pairs.set(key, [...(pairs.get(key) ?? []), row]);
  }
  return [...pairs.values()].map((list) => ({ ids: pairKey(list[0].fromAgentId, list[0].toAgentId), last: list[0], stopped: isStopped(list) }));
}

export async function loadPair(a: string, b: string, limit = 200) {
  const rows = await getDb().select().from(schema.agentMessages).where(between(a, b)).orderBy(desc(schema.agentMessages.createdAt)).limit(limit);
  const stopped = isStopped(rows);
  return { rows: rows.reverse(), stopped };
}

export async function setPairStopped(a: string, b: string, stopped: boolean) {
  const [from, to] = pairKey(a, b);
  const db = getDb();
  if ((await pairStopped(from, to)) === stopped) return false;
  await db.insert(schema.agentMessages).values({ id: newId("amsg"), fromAgentId: from, toAgentId: to, kind: stopped ? "stop" : "resume", text: "", depth: 0, delivered: true });
  if (stopped) {
    await db
      .delete(schema.inboundQueue)
      .where(
        and(
          eq(schema.inboundQueue.source, "team"),
          or(
            and(eq(schema.inboundQueue.agentId, to), sql`${schema.inboundQueue.message}->'fromAgent'->>'id' = ${from}`),
            and(eq(schema.inboundQueue.agentId, from), sql`${schema.inboundQueue.message}->'fromAgent'->>'id' = ${to}`),
          ),
        ),
      );
  }
  console.log(JSON.stringify({ event: stopped ? "pair_stopped" : "pair_resumed", from, to }));
  return true;
}
