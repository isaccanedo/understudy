import { Cron } from "croner";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { messages } from "@/lib/messages";
import { escapeSlack, sendDirectMessage, slackEnabled } from "./slack";

export async function briefingFor(userId: string, since: Date) {
  const db = getDb();
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.ownerId, userId));
  if (agents.length === 0) return null;
  const ids = agents.map((a) => a.id);
  const runs = await db
    .select({ agentId: schema.runs.agentId, status: schema.runs.status, summary: schema.runs.summary })
    .from(schema.runs)
    .where(and(inArray(schema.runs.agentId, ids), gte(schema.runs.startedAt, since)));
  const pending = await db
    .select({ id: schema.approvals.id })
    .from(schema.approvals)
    .where(and(inArray(schema.approvals.agentId, ids), eq(schema.approvals.status, "pending")));
  const ok = runs.filter((r) => r.status === "ok").length;
  const failed = runs.filter((r) => r.status === "failed");
  if (runs.length === 0 && pending.length === 0) return null;
  const t = messages.briefing;
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? "";
  const lines = [t.header, t.runs(ok, failed.length)];
  for (const f of failed.slice(0, 5)) lines.push(`• ${escapeSlack(nameOf(f.agentId))}: ${escapeSlack(f.summary ?? "")}`);
  if (pending.length > 0) lines.push(t.pending(pending.length));
  lines.push(`${env.publicUrl}/`);
  return lines.join("\n");
}

export async function sendBriefings() {
  if (!(await slackEnabled())) return;
  const db = getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const users = await db.select({ id: schema.user.id, email: schema.user.email }).from(schema.user).where(eq(schema.user.status, "approved"));
  for (const user of users) {
    const text = await briefingFor(user.id, since).catch((error) => {
      console.error(JSON.stringify({ event: "briefing_build_error", userId: user.id, error: String(error) }));
      return null;
    });
    if (!text) continue;
    const result = await sendDirectMessage(user, text);
    console.log(JSON.stringify({ at: new Date().toISOString(), event: "briefing_sent", userId: user.id, ok: result.ok }));
  }
}

export function startBriefings() {
  const expression = process.env.UNDERSTUDY_BRIEFING_CRON?.trim() || "0 8 * * 1-5";
  const timezone = process.env.UNDERSTUDY_TIMEZONE?.trim() || "UTC";
  if (expression === "off") return null;
  return new Cron(expression, { timezone, protect: true }, () => {
    sendBriefings().catch((error) => console.error("briefing_error", error));
  });
}
