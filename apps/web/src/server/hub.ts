import type { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { parseComputerToServer, type ApprovalRequest, type Attachment, type ComputerToServer, type JobInfo, type ServerToComputer } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import type { MessageArtifact, RunTrigger } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { messages as copy } from "@/lib/messages";
import { Approvals } from "./hub/approvals";
import { handleComputerMessage } from "./hub/computer-handlers";
import { Hosts } from "./hub/hosts";
import { IdleSleeper } from "./hub/idle";
import { InboundQueue, type DeliverOptions } from "./hub/inbound-queue";
import { Recordings } from "./hub/recordings";
import { Rooms } from "./hub/rooms";
import { Runs } from "./hub/runs";
import { log, send, type Frame, type HostConn, type Viewer } from "./hub/shared";
import { handleViewerMessage } from "./hub/viewer-handlers";
import type { ChatEntry, ServerToViewer, ViewerToServer } from "./hub-types";
import { computerLimit, RateLimiter } from "./rate-limit";
import { Watcher } from "./watcher";
import { Uploads } from "./files/uploads";

export type { Viewer } from "./hub/shared";

type FileAnswer = { base64?: string; error?: string };

export type ComputerReply = Extract<ComputerToServer, { type: "upload_state" | "upload_done" | "file_chunk" | "file_shared" | "artifact_rendered" }>;

export type AskFailure = { type: "failed"; error: "offline" | "timeout" };

type AskRequest = Extract<ServerToComputer, { requestId: string }>;

const PING_INTERVAL_MS = 30_000;
const QUEUE_TICK_MS = 3_000;
const QUIET_COMPUTER_MESSAGES = new Set<string>(["frame", "pong", "jobs", "files", "memory", "credentials", "watch_result"]);

export class Hub {
  readonly approvals = new Approvals(this);
  readonly runs = new Runs(this);
  readonly recordings = new Recordings(this);
  readonly hosts = new Hosts(this);
  readonly inbound = new InboundQueue(this);
  readonly watcher = new Watcher(this);
  readonly idle = new IdleSleeper(this);
  readonly rooms = new Rooms(this);
  readonly uploads = new Uploads();
  private computers = new Map<string, WebSocket>();
  private fallingAsleep = new Set<string>();
  private viewers = new Map<string, Set<Viewer>>();
  private lastFrames = new Map<string, Frame>();
  private lastJobs = new Map<string, JobInfo[]>();
  private fileRequests = new Map<string, { agentId: string; resolve: (value: FileAnswer) => void }>();
  private asks = new Map<string, { agentId: string; resolve: (value: ComputerReply) => void }>();
  private limiter = new RateLimiter();
  private timer: NodeJS.Timeout;
  private queueTimer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => this.pingAll(), PING_INTERVAL_MS);
    this.timer.unref();
    this.queueTimer = setInterval(() => {
      this.inbound.tick([...this.computers.keys()]).catch((error) => log("inbound_tick_error", { error: String(error) }));
    }, QUEUE_TICK_MS);
    this.queueTimer.unref();
  }

  stats() {
    return {
      computers: this.computers.size,
      hosts: this.hosts.stats(),
      viewers: [...this.viewers.values()].reduce((n, set) => n + set.size, 0),
    };
  }

  isOnline(agentId: string) {
    return this.computers.has(agentId);
  }

  private pingAll() {
    const at = Date.now();
    for (const ws of this.computers.values()) send(ws, { type: "ping", at } satisfies ServerToComputer);
    this.hosts.ping();
    for (const set of this.viewers.values()) for (const v of set) if (v.ws.readyState === v.ws.OPEN) v.ws.ping();
    this.approvals.expire().catch((error) => log("approval_expire_error", { error: String(error) }));
    this.inbound.expire().catch((error) => log("inbound_expire_error", { error: String(error) }));
    this.rooms.expireStale().catch((error) => log("room_expire_error", { error: String(error) }));
  }

  deliver(agentId: string, message: ServerToComputer, options: DeliverOptions) {
    return this.inbound.deliver(agentId, message, options);
  }

  sendToComputer(agentId: string, message: ServerToComputer) {
    const ws = this.computers.get(agentId);
    if (!ws || this.fallingAsleep.has(agentId)) return false;
    if (message.type !== "ping") this.idle.touch(agentId);
    send(ws, message);
    return true;
  }

  broadcast(agentId: string, message: ServerToViewer) {
    const set = this.viewers.get(agentId);
    if (!set) return;
    const payload = JSON.stringify(message);
    for (const v of set) if (v.ws.readyState === v.ws.OPEN) v.ws.send(payload);
  }

  sendToOwners(agentId: string, message: ServerToViewer) {
    const set = this.viewers.get(agentId);
    if (!set) return;
    const payload = JSON.stringify(message);
    for (const v of set) if (v.owner && v.ws.readyState === v.ws.OPEN) v.ws.send(payload);
  }

  announceViewers(agentId: string) {
    this.sendToComputer(agentId, { type: "viewers", count: this.viewers.get(agentId)?.size ?? 0 });
  }

  async putToSleep(agentId: string) {
    this.fallingAsleep.add(agentId);
    await this.hosts.sleep(agentId);
  }

  viewerCount(agentId: string) {
    return this.viewers.get(agentId)?.size ?? 0;
  }

  runningJobs(agentId: string) {
    return (this.lastJobs.get(agentId) ?? []).filter((job) => job.status === "running").length;
  }

  rememberJobs(agentId: string, jobs: JobInfo[]) {
    this.lastJobs.set(agentId, jobs);
  }

  rememberFrame(agentId: string, frame: Frame) {
    this.lastFrames.set(agentId, frame);
  }

  resolveFile(agentId: string, requestId: string, value: FileAnswer) {
    const pending = this.fileRequests.get(requestId);
    if (!pending || pending.agentId !== agentId) return;
    this.fileRequests.delete(requestId);
    pending.resolve(value);
  }

  requestFile(agentId: string, path: string, timeoutMs = 60_000) {
    return new Promise<FileAnswer>((resolve) => {
      const requestId = newId("file");
      if (!this.sendToComputer(agentId, { type: "file_get", requestId, path })) {
        resolve({ error: "offline" });
        return;
      }
      const timer = setTimeout(() => {
        this.fileRequests.delete(requestId);
        resolve({ error: "timeout" });
      }, timeoutMs);
      this.fileRequests.set(requestId, {
        agentId,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });
  }

  askComputer<T extends ComputerReply>(agentId: string, message: AskRequest, timeoutMs = 120_000): Promise<T | AskFailure> {
    return new Promise((resolve) => {
      if (!this.sendToComputer(agentId, message)) {
        resolve({ type: "failed", error: "offline" });
        return;
      }
      const timer = setTimeout(() => {
        this.asks.delete(message.requestId);
        resolve({ type: "failed", error: "timeout" });
      }, timeoutMs);
      this.asks.set(message.requestId, {
        agentId,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
      });
    });
  }

  answerAsk(agentId: string, reply: ComputerReply) {
    const pending = this.asks.get(reply.requestId);
    if (!pending || pending.agentId !== agentId) return;
    this.asks.delete(reply.requestId);
    pending.resolve(reply);
  }

  async addMessage(
    agentId: string,
    role: ChatEntry["role"],
    text: string,
    runId?: string | null,
    authorId?: string,
    via?: string,
    streamId?: string,
    attachments?: Attachment[],
    artifact?: MessageArtifact,
  ) {
    const id = newId("msg");
    const createdAt = new Date();
    const files = attachments?.length ? attachments : null;
    await getDb().insert(schema.messages).values({ id, agentId, role, text, runId: runId ?? null, authorId, via: via ?? null, attachments: files, artifact: artifact ?? null, createdAt });
    this.broadcast(agentId, {
      type: "chat",
      entry: { id, role, text, runId: runId ?? null, via: via ?? null, streamId: streamId ?? null, at: createdAt.toISOString(), ...(files ? { attachments: files } : {}), ...(artifact ? { artifact } : {}) },
    });
    return id;
  }

  async attachComputer(ws: WebSocket, agentId: string) {
    const previous = this.computers.get(agentId);
    if (previous && previous !== ws) previous.close(4000, "replaced");
    this.computers.set(agentId, ws);
    this.fallingAsleep.delete(agentId);
    this.idle.touch(agentId);
    log("computer_connected", { agentId });
    let queue: Promise<void> = Promise.resolve();

    ws.on("message", (raw) => {
      let value: { type?: unknown };
      try {
        value = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const type = String(value?.type ?? "");
      const [perSecond, burst] = computerLimit(type);
      if (!this.limiter.allow(`${agentId}:${type}`, perSecond, burst)) {
        if (this.limiter.allow(`${agentId}:warned`, 1 / 60, 1)) log("computer_rate_limited", { agentId, type });
        return;
      }
      const parsed = parseComputerToServer(value);
      if (!parsed.ok) {
        if (this.limiter.allow(`${agentId}:invalid`, 1 / 60, 1)) log("computer_message_invalid", { agentId, type, error: parsed.error });
        return;
      }
      const message: ComputerToServer = parsed.message;
      if (!QUIET_COMPUTER_MESSAGES.has(message.type)) this.idle.touch(agentId);
      if (message.type === "upload_state" || message.type === "upload_done" || message.type === "file_chunk" || message.type === "file_shared" || message.type === "artifact_rendered") {
        this.answerAsk(agentId, message);
        return;
      }
      if (message.type === "frame") {
        Promise.resolve(handleComputerMessage(this, agentId, message)).catch((error) => {
          if (this.limiter.allow(`${agentId}:frame_error`, 1 / 60, 1)) log("computer_frame_error", { agentId, error: String(error) });
        });
        return;
      }
      queue = queue
        .then(() => handleComputerMessage(this, agentId, message))
        .catch((error) => log("computer_message_error", { agentId, type: message.type, error: String(error) }));
    });

    ws.on("close", () => {
      if (this.computers.get(agentId) !== ws) return;
      this.computers.delete(agentId);
      this.idle.forget(agentId);
      this.fallingAsleep.delete(agentId);
      this.lastFrames.delete(agentId);
      this.lastJobs.delete(agentId);
      for (const [requestId, pending] of this.asks) {
        if (pending.agentId !== agentId) continue;
        this.asks.delete(requestId);
        pending.resolve({ type: "file_chunk", requestId, error: "offline" });
      }
      log("computer_disconnected", { agentId });
      this.broadcast(agentId, { type: "presence", online: false, computerStatus: "offline" });
      this.rooms.presenceChanged(agentId).catch((error) => log("room_presence_error", { agentId, error: String(error) }));
    });

    await getDb()
      .update(schema.agents)
      .set({ computerStatus: "running", lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.agents.id, agentId));
    this.broadcast(agentId, { type: "presence", online: true, computerStatus: "running" });
    this.rooms.presenceChanged(agentId).catch((error) => log("room_presence_error", { agentId, error: String(error) }));
  }

  async attachViewer(ws: WebSocket, agentId: string, userId: string, access: "owner" | "approver" | "viewer" = "owner") {
    const viewer: Viewer = { ws, userId, owner: access === "owner" };
    const set = this.viewers.get(agentId) ?? new Set<Viewer>();
    set.add(viewer);
    this.viewers.set(agentId, set);
    this.announceViewers(agentId);
    const refuse = (text: string) => send(ws, { type: "error", message: text } satisfies ServerToViewer);
    const offline = () => refuse(copy.live.computerOffline);

    ws.on("message", (raw) => {
      let message: ViewerToServer;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (access !== "owner" || typeof message?.type !== "string") return;
      Promise.resolve(handleViewerMessage({ hub: this, agentId, userId, offline, refuse }, message)).catch((error) =>
        log("viewer_message_error", { agentId, type: message.type, error: String(error) }),
      );
    });

    ws.on("close", () => {
      set.delete(viewer);
      this.idle.touch(agentId);
      if (set.size === 0) this.viewers.delete(agentId);
      this.announceViewers(agentId);
    });

    const [agent] = await getDb().select().from(schema.agents).where(eq(schema.agents.id, agentId));
    if (!agent) return;
    if (viewer.owner && agent.computerStatus === "sleeping" && !this.isOnline(agentId)) {
      this.hosts.ensure(agentId).catch((error) => log("wake_on_view_error", { agentId, error: String(error) }));
    }
    send(ws, {
      type: "snapshot",
      online: this.isOnline(agentId),
      state: agent.state,
      note: agent.stateNote,
      computerStatus: this.isOnline(agentId) ? "running" : agent.computerStatus,
      brains: agent.brains,
      recordingId: this.recordings.active(agentId),
      frame: this.lastFrames.get(agentId) ?? null,
    } satisfies ServerToViewer);
    const jobs = this.lastJobs.get(agentId);
    if (viewer.owner && jobs) send(ws, { type: "jobs", jobs } satisfies ServerToViewer);
  }

  attachRoomViewer(ws: WebSocket, roomId: string, userId: string) {
    this.rooms.attachViewer(ws, roomId, userId);
  }

  attachHost(ws: WebSocket) {
    this.hosts.attach(ws);
  }

  closeViewers(filter: (agentId: string, viewer: Viewer) => boolean) {
    for (const [agentId, set] of this.viewers) {
      for (const viewer of set) if (filter(agentId, viewer)) viewer.ws.close(4003, "forbidden");
    }
  }

  closeComputer(agentId: string) {
    this.computers.get(agentId)?.close(4003, "forbidden");
  }

  activeRecording(agentId: string) {
    return this.recordings.active(agentId);
  }

  startRecording(agentId: string) {
    return this.recordings.start(agentId);
  }

  stopRecording(agentId: string) {
    return this.recordings.stop(agentId);
  }

  createApproval(
    agentId: string,
    request: Partial<ApprovalRequest> & { summary: string },
    source: "mcp" | "computer",
    timeoutSeconds?: number,
    payloadHash?: string,
  ) {
    return this.approvals.create(agentId, request, source, timeoutSeconds, payloadHash);
  }

  approvalPayloadHash(id: string, agentId: string) {
    return this.approvals.payloadHash(id, agentId);
  }

  useActionApproval(agentId: string, hash: string, maxAgeMs: number) {
    return this.approvals.useActionApproval(agentId, hash, maxAgeMs);
  }

  approvalOutcome(id: string, agentId: string) {
    return this.approvals.outcome(id, agentId);
  }

  waitForApproval(id: string, capMs: number) {
    return this.approvals.wait(id, capMs);
  }

  answerApproval(id: string, approved: boolean, note: string | undefined, userId: string) {
    return this.approvals.answer(id, approved, note, userId);
  }

  cancelApprovals(agentId: string, userId: string | null) {
    return this.approvals.cancelPending(agentId, userId);
  }

  approvalStatus(id: string) {
    return this.approvals.status(id);
  }

  pendingApprovalsFor(agentIds: string[]) {
    return this.approvals.pendingFor(agentIds);
  }

  notifyOwner(agentId: string, text: string) {
    return this.approvals.notifyOwner(agentId, text);
  }

  startRun(recipeId: string, trigger: RunTrigger, options: { scheduledFor?: Date; input?: string } = {}) {
    return this.runs.start(recipeId, trigger, options);
  }

  finishRun(agentId: string, runId: string, ok: boolean, summary: string) {
    return this.runs.finish(agentId, runId, ok, summary);
  }

  ensureComputer(agentId: string, preferred?: HostConn) {
    return this.hosts.ensure(agentId, preferred);
  }

  stopComputer(agentId: string, destroy = false) {
    this.hosts.stop(agentId, destroy);
  }
}

const store = globalThis as unknown as { __understudyHub?: Hub };

export function createHub() {
  store.__understudyHub ??= new Hub();
  return store.__understudyHub;
}
