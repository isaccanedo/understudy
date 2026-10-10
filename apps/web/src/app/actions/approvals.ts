"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { agentAccess, canApprove } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { getHub } from "@/server/hub-access";

export async function answerApproval(approvalId: string, approved: boolean, note?: string) {
  const user = await requireUser();
  const db = getDb();
  const [row] = await db
    .select({ agentId: schema.approvals.agentId })
    .from(schema.approvals)
    .where(eq(schema.approvals.id, approvalId));
  if (!row || !canApprove(await agentAccess(user.id, row.agentId))) return { ok: false };
  const hub = getHub();
  let ok = false;
  if (hub) {
    ok = await hub.answerApproval(approvalId, approved, note?.trim() || undefined, user.id);
  } else {
    const updated = await db
      .update(schema.approvals)
      .set({ status: approved ? "approved" : "denied", note: note ?? null, answeredBy: user.id, answeredAt: new Date() })
      .where(and(eq(schema.approvals.id, approvalId), eq(schema.approvals.status, "pending")))
      .returning();
    ok = updated.length > 0;
  }
  revalidatePath("/", "layout");
  if (ok) return { ok, status: approved ? "approved" : "denied" };
  const [current] = await db.select({ status: schema.approvals.status }).from(schema.approvals).where(eq(schema.approvals.id, approvalId));
  return { ok, status: current?.status ?? null };
}
