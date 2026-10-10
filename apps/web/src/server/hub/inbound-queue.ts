import { and, asc, eq, inArray, lt } from "drizzle-orm";
import type { ServerToComputer } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/ids";
import { messages as copy } from "@/lib/messages";
import type { Hub } from "../hub";
import { rememberSlackReply, slackGiveUp } from "../slack-inbound";
import { log } from "./shared";

export const QUEUE_TTL_MS = 30 * 60 * 1000;
const RECENTLY_SEEN_MS = 3 * 60 * 1000;

export type InboundSource = "panel" | "slack" | "team" | "email" | "run" | "room";

export type DeliverOptions = { source: InboundSource; slack?: { channel: string; threadTs?: string }; runId?: string };

export type DeliverResult = { status: "sent" } | { status: "queued"; starting: boolean };

type Row = typeof schema.inboundQueue.$inferSelect;

export class InboundQueue {
  private flushing = new Set<string>();

  constructor(private hub: Hub) {}

  async deliver(agentId: string, message: ServerToComputer, options: DeliverOptions): Promise<DeliverResult> {
    if (this.hub.sendToComputer(agentId, message)) return { status: "sent" };
    const now = new Date();
    await getDb()
      .insert(schema.inboundQueue)
      .values({
        id: newId("inq"),
        agentId,
        message: message as unknown as Record<string, unknown>,
        source: options.source,
        slackChannel: options.slack?.channel ?? null,
        slackThreadTs: options.slack?.threadTs ?? null,
        runId: options.runId ?? null,
        expiresAt: new Date(now.getTime() + QUEUE_TTL_MS),
      });
    const starting = await this.wakeIfStopped(agentId, now);
    log("inbound_queued", { agentId, source: options.source, type: message.type, starting });
    if (this.hub.isOnline(agentId)) await this.flush(agentId);
    return { status: "queued", starting };
  }

  private async wakeIfStopped(agentId: string, now: Date) {
    const [agent] = await getDb()
      .select({ status: schema.agents.computerStatus, lastSeenAt: schema.agents.lastSeenAt })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId));
    if (!agent) return false;
    const recentlyUp = (agent.status === "running" || agent.status === "starting") && agent.lastSeenAt && now.getTime() - agent.lastSeenAt.getTime() < RECENTLY_SEEN_MS;
    if (recentlyUp) return false;
    await this.hub.ensureComputer(agentId).catch((error) => log("ensure_computer_error", { agentId, error: String(error) }));
    return true;
  }

  async flush(agentId: string) {
    if (this.flushing.has(agentId) || !this.hub.isOnline(agentId)) return 0;
    this.flushing.add(agentId);
    try {
      const db = getDb();
      const now = new Date();
      const rows = await db
        .select()
        .from(schema.inboundQueue)
        .where(eq(schema.inboundQueue.agentId, agentId))
        .orderBy(asc(schema.inboundQueue.createdAt))
        .limit(100);
      let sent = 0;
      for (const row of rows) {
        if (row.expiresAt < now) continue;
        const [claimed] = await db.delete(schema.inboundQueue).where(eq(schema.inboundQueue.id, row.id)).returning();
        if (!claimed) continue;
        if (claimed.slackChannel) await rememberSlackReply(agentId, claimed.slackChannel, claimed.slackThreadTs ?? undefined);
        if (!this.hub.sendToComputer(agentId, claimed.message as unknown as ServerToComputer)) {
          await db.insert(schema.inboundQueue).values(claimed).onConflictDoNothing();
          break;
        }
        sent += 1;
      }
      if (sent) log("inbound_flushed", { agentId, sent });
      return sent;
    } finally {
      this.flushing.delete(agentId);
    }
  }

  async tick(connected: string[]) {
    if (connected.length === 0) return;
    const waiting = await getDb()
      .selectDistinct({ agentId: schema.inboundQueue.agentId })
      .from(schema.inboundQueue)
      .where(inArray(schema.inboundQueue.agentId, connected));
    for (const { agentId } of waiting) await this.flush(agentId);
  }

  async expire(now = new Date()) {
    const db = getDb();
    const expired = await db.delete(schema.inboundQueue).where(lt(schema.inboundQueue.expiresAt, now)).returning();
    for (const row of expired) await this.giveUp(row);
    if (expired.length) log("inbound_expired", { count: expired.length });
  }

  private async giveUp(row: Row) {
    if (row.runId) {
      await getDb()
        .update(schema.runs)
        .set({ status: "failed", summary: copy.runs.computerOffline, finishedAt: new Date() })
        .where(and(eq(schema.runs.id, row.runId), eq(schema.runs.agentId, row.agentId), eq(schema.runs.status, "running")));
    }
    if (row.slackChannel) await slackGiveUp(row.agentId, row.slackChannel, row.slackThreadTs ?? undefined).catch((error) => log("slack_give_up_error", { error: String(error) }));
    if (row.source === "panel" || row.source === "team") await this.hub.addMessage(row.agentId, "system", copy.live.queueExpired);
    if (row.source === "room" && typeof row.message.roomId === "string") await this.hub.rooms.turnDone(row.agentId, row.message.roomId, false, copy.rooms.computerOff);
  }
}
