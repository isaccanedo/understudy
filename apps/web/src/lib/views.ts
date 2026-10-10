import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { ApprovalView, ChatEntry } from "@/server/hub-types";

export async function loadChat(agentId: string, limit = 150): Promise<ChatEntry[]> {
  const rows = await getDb()
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.agentId, agentId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit);
  return rows
    .reverse()
    .map((m) => ({ id: m.id, role: m.role, text: m.text, runId: m.runId, via: m.via, at: m.createdAt.toISOString(), ...(m.attachments?.length ? { attachments: m.attachments } : {}), ...(m.artifact ? { artifact: m.artifact } : {}) }));
}

export async function loadPendingApprovals(agentId: string): Promise<ApprovalView[]> {
  const rows = await getDb()
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.agentId, agentId), eq(schema.approvals.status, "pending")))
    .orderBy(asc(schema.approvals.createdAt));
  return rows.map(toApprovalView);
}

export function toApprovalView(a: typeof schema.approvals.$inferSelect): ApprovalView {
  return {
    id: a.id,
    agentId: a.agentId,
    runId: a.runId,
    stepId: a.stepId,
    summary: a.summary,
    fields: a.fields,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function loadRuns(agentId: string, limit = 8) {
  return getDb()
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.agentId, agentId))
    .orderBy(desc(schema.runs.startedAt))
    .limit(limit);
}
