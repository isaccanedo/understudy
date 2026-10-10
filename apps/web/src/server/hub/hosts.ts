import type { WebSocket } from "ws";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { parseHostToServer, type HostToServer, type ServerToHost } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { canPlaceOn, hostAdmission } from "@/lib/host-policy";
import { hashToken, newComputerToken } from "@/lib/ids";
import type { Hub } from "../hub";
import { log, send, type HostConn } from "./shared";

export class Hosts {
  private hosts = new Map<string, HostConn>();

  constructor(private hub: Hub) {}

  stats() {
    return [...this.hosts.values()].map((h) => ({ hostId: h.hostId, capacity: h.capacity, running: h.running.size }));
  }

  ping() {
    for (const host of this.hosts.values()) if (host.ws.readyState === host.ws.OPEN) host.ws.ping();
  }

  attach(ws: WebSocket) {
    let conn: HostConn | null = null;
    ws.on("message", (raw) => {
      const parsed = parseHostToServer(raw.toString());
      if (!parsed.ok) {
        log("host_message_invalid", { error: parsed.error });
        return;
      }
      const message: HostToServer = parsed.message;
      if (message.type === "host_hello") {
        this.admit(message.hostId)
          .then(async (admitted) => {
            if (!admitted) {
              ws.close(4003, "unknown host");
              return;
            }
            const running = await this.boundOrFree(message.hostId, message.running);
            conn = { ws, hostId: message.hostId, capacity: message.capacity, running: new Set(running) };
            const previous = this.hosts.get(message.hostId);
            if (previous && previous.ws !== ws) previous.ws.close(4000, "replaced");
            this.hosts.set(message.hostId, conn);
            log("host_connected", { hostId: message.hostId, capacity: message.capacity, running: running.length });
            await this.reconcile(conn);
          })
          .catch((error) => log("host_hello_error", { hostId: message.hostId, error: String(error) }));
        return;
      }
      if (message.type === "computer_status" && conn) {
        this.onComputerStatus(conn, message).catch((error) => log("computer_status_error", { error: String(error) }));
      }
    });
    ws.on("close", () => {
      if (conn && this.hosts.get(conn.hostId) === conn) {
        this.hosts.delete(conn.hostId);
        log("host_disconnected", { hostId: conn.hostId });
      }
    });
  }

  async admit(hostId: string) {
    const db = getDb();
    const [known] = await db.select().from(schema.hosts).where(eq(schema.hosts.id, hostId));
    const anyTrusted = known ? true : (await db.select({ id: schema.hosts.id }).from(schema.hosts).where(eq(schema.hosts.trusted, true)).limit(1)).length > 0;
    const admission = hostAdmission({ hostId: hostId.toLowerCase(), allowlist: env.hostIds, known: known ?? null, anyTrusted });
    if (admission === "refuse") {
      if (!known) await db.insert(schema.hosts).values({ id: hostId, trusted: false }).onConflictDoNothing();
      else await db.update(schema.hosts).set({ lastSeenAt: new Date() }).where(eq(schema.hosts.id, hostId));
      log("host_refused", { hostId });
      return false;
    }
    await db
      .insert(schema.hosts)
      .values({ id: hostId, trusted: true })
      .onConflictDoUpdate({ target: schema.hosts.id, set: { lastSeenAt: new Date(), ...(admission === "pin" || env.hostIds.length > 0 ? { trusted: true } : {}) } });
    if (admission === "pin") log("host_pinned", { hostId });
    return true;
  }

  private async boundOrFree(hostId: string, agentIds: string[]) {
    if (agentIds.length === 0) return [];
    const rows = await getDb()
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(inArray(schema.agents.id, agentIds), or(isNull(schema.agents.hostId), eq(schema.agents.hostId, hostId))));
    return rows.map((row) => row.id);
  }

  disconnect(hostId: string) {
    this.hosts.get(hostId)?.ws.close(4003, "forbidden");
  }

  private async onComputerStatus(conn: HostConn, message: Extract<HostToServer, { type: "computer_status" }>) {
    if (message.status === "running" || message.status === "starting") conn.running.add(message.agentId);
    else conn.running.delete(message.agentId);
    const [agent] = await getDb()
      .update(schema.agents)
      .set({ computerStatus: message.status === "stopped" ? sql`case when ${schema.agents.computerStatus} = 'sleeping' then 'sleeping' else 'stopped' end` : message.status, computerMessage: message.message ?? null, updatedAt: new Date() })
      .where(eq(schema.agents.id, message.agentId))
      .returning();
    if (!agent) return;
    log("computer_status", { agentId: message.agentId, status: agent.computerStatus, message: message.message });
    this.hub.broadcast(message.agentId, {
      type: "presence",
      online: this.hub.isOnline(message.agentId),
      computerStatus: agent.computerStatus,
      message: message.message ?? null,
    });
  }

  private async reconcile(conn: HostConn) {
    const all = await getDb()
      .select({ id: schema.agents.id, status: schema.agents.computerStatus, hostId: schema.agents.hostId })
      .from(schema.agents)
      .innerJoin(schema.user, eq(schema.user.id, schema.agents.ownerId))
      .where(eq(schema.user.status, "approved"));
    const placed = new Set([...this.hosts.values()].flatMap((h) => [...h.running]));
    for (const agent of all) {
      if (agent.status === "stopped_by_owner" || agent.status === "sleeping") continue;
      if (placed.has(agent.id) || this.hub.isOnline(agent.id)) continue;
      if (!canPlaceOn(agent.hostId, conn.hostId)) continue;
      await this.ensure(agent.id, conn);
    }
  }

  private pick(boundTo: string | null) {
    if (boundTo) {
      const host = this.hosts.get(boundTo);
      return host && host.ws.readyState === host.ws.OPEN ? host : null;
    }
    let best: HostConn | null = null;
    for (const host of this.hosts.values()) {
      if (host.ws.readyState !== host.ws.OPEN) continue;
      const free = host.capacity - host.running.size;
      if (free <= 0) continue;
      if (!best || free > best.capacity - best.running.size) best = host;
    }
    return best;
  }

  async ensure(agentId: string, preferred?: HostConn) {
    const db = getDb();
    const [agent] = await db.select({ hostId: schema.agents.hostId }).from(schema.agents).where(eq(schema.agents.id, agentId));
    if (!agent) return false;
    const host = preferred && canPlaceOn(agent.hostId, preferred.hostId) ? preferred : this.pick(agent.hostId);
    if (!host) {
      log("ensure_no_host", { agentId, boundTo: agent.hostId });
      return false;
    }
    const token = newComputerToken();
    const bound = await db
      .update(schema.agents)
      .set({ tokenHash: hashToken(token), hostId: host.hostId, computerStatus: "starting", updatedAt: new Date() })
      .where(and(eq(schema.agents.id, agentId), or(isNull(schema.agents.hostId), eq(schema.agents.hostId, host.hostId))))
      .returning({ id: schema.agents.id });
    if (bound.length === 0) {
      log("ensure_refused_other_host", { agentId, hostId: host.hostId });
      return false;
    }
    host.running.add(agentId);
    send(host.ws, {
      type: "computer_ensure",
      spec: { agentId, token, image: env.computerImage, serverUrl: env.computerServerUrl },
    } satisfies ServerToHost);
    log("computer_ensure", { agentId, hostId: host.hostId });
    return true;
  }

  async sleep(agentId: string) {
    await getDb().update(schema.agents).set({ computerStatus: "sleeping", updatedAt: new Date() }).where(eq(schema.agents.id, agentId));
    this.stop(agentId);
  }

  stop(agentId: string, destroy = false) {
    for (const host of this.hosts.values()) {
      if (!host.running.has(agentId)) continue;
      send(host.ws, destroy ? { type: "computer_destroy", agentId } : { type: "computer_stop", agentId });
      host.running.delete(agentId);
    }
  }
}
