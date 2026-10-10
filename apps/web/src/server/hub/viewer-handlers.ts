import { eq } from "drizzle-orm";
import { ArtifactEditSchema, MEMORY_FILE_MAX_BYTES } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import { credentialSite } from "@/lib/credential-site";
import { mirrorPanelMessage } from "../slack-threads";
import { messages as copy } from "@/lib/messages";
import { prepareEdit } from "../artifacts/service";
import type { Hub } from "../hub";
import type { ViewerToServer } from "../hub-types";
import { log } from "./shared";

export type ViewerContext = { hub: Hub; agentId: string; userId: string; offline: () => void; refuse: (text: string) => void };

type Handlers = {
  [K in ViewerToServer["type"]]: (ctx: ViewerContext, message: Extract<ViewerToServer, { type: K }>) => Promise<void> | void;
};

function safeMemoryPath(path: unknown) {
  const value = String(path ?? "").trim();
  return value && !value.includes("..") && !value.startsWith("/") && !value.includes("\\") ? value : null;
}

function cleanTerminalId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(value) ? value : null;
}

function clampSize(value: unknown, min: number, max: number, fallback: number) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export const viewerHandlers: Handlers = {
  input({ hub, agentId }, message) {
    hub.sendToComputer(agentId, { type: "input", event: message.event });
  },

  async chat({ hub, agentId, userId, refuse }, message) {
    const text = String(message.text ?? "").trim().slice(0, 4000);
    const edit = message.artifactEdit === undefined ? null : ArtifactEditSchema.safeParse(message.artifactEdit);
    if (edit && (!edit.success || !text)) return refuse(copy.artifacts.editRefused);
    const prepared = edit?.success ? await prepareEdit(hub, agentId, edit.data) : null;
    if (edit && !prepared) return refuse(copy.artifacts.editRefused);
    const attachments = hub.uploads.claim(agentId, userId, message.attachments);
    if (!text && !attachments.length) return;
    const [user] = await getDb().select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId));
    await hub.addMessage(agentId, "user", text, null, userId, undefined, undefined, attachments, prepared?.card);
    const lead = prepared ? copy.artifacts.editMirror(prepared.title, prepared.card.version) : "";
    const mirrored = [lead, text, ...attachments.map((a) => `📎 ${a.name}`)].filter(Boolean).join("\n");
    mirrorPanelMessage(agentId, user?.name ?? "", mirrored).catch((error) => log("slack_mirror_error", { agentId, error: String(error) }));
    const artifactEdit = prepared
      ? { artifactId: prepared.card.artifactId, version: prepared.card.version, title: prepared.title, path: prepared.path, ...prepared.card.edit }
      : undefined;
    const result = await hub.deliver(agentId, { type: "chat", text, from: user?.name ?? "", ...(attachments.length ? { attachments } : {}), ...(artifactEdit ? { artifactEdit } : {}) }, { source: "panel" });
    if (result.status === "queued") await hub.addMessage(agentId, "system", result.starting ? copy.live.startingQueued : copy.live.queued);
  },

  async record_start({ hub, agentId }) {
    await hub.recordings.start(agentId);
  },

  record_narration({ hub, agentId }, message) {
    const recordingId = hub.recordings.active(agentId);
    const text = String(message.text ?? "").trim().slice(0, 4000);
    if (!recordingId || !text) return;
    hub.sendToComputer(agentId, { type: "record_narration", recordingId, text });
  },

  async record_stop({ hub, agentId }) {
    await hub.recordings.stop(agentId);
  },

  async teach_text({ hub, agentId, offline }, message) {
    const text = String(message.text ?? "").trim().slice(0, 20000);
    if (!text) return;
    if (!hub.isOnline(agentId)) return offline();
    await hub.recordings.startFromText(agentId, text);
  },

  login_start({ hub, agentId, offline }, message) {
    if (!hub.sendToComputer(agentId, { type: "login_start", brain: message.brain })) offline();
  },

  login_code({ hub, agentId, offline }, message) {
    if (!hub.sendToComputer(agentId, { type: "login_code", brain: message.brain, code: String(message.code ?? "").trim() })) offline();
  },

  async set_brain({ hub, agentId }, message) {
    await getDb().update(schema.agents).set({ brain: message.brain, updatedAt: new Date() }).where(eq(schema.agents.id, agentId));
    hub.sendToComputer(agentId, { type: "set_brain", brain: message.brain });
  },

  async stop({ hub, agentId, userId }) {
    hub.sendToComputer(agentId, { type: "stop" });
    await hub.cancelApprovals(agentId, userId);
  },

  memory_write({ hub, agentId, offline }, message) {
    const path = safeMemoryPath(message.path);
    if (!path) return;
    const text = String(message.text ?? "").slice(0, MEMORY_FILE_MAX_BYTES);
    if (!hub.sendToComputer(agentId, { type: "memory_write", path, text })) offline();
  },

  memory_delete({ hub, agentId, offline }, message) {
    const path = safeMemoryPath(message.path);
    if (!path) return;
    if (!hub.sendToComputer(agentId, { type: "memory_delete", path })) offline();
  },

  credential_set({ hub, agentId, offline, refuse }, message) {
    const name = String(message.name ?? "").trim();
    const secret = String(message.secret ?? "");
    if (!/^[A-Za-z0-9 .@_-]{1,64}$/.test(name) || !secret) return;
    const site = credentialSite(message.site);
    if (!site) {
      refuse(copy.vault.siteRequired);
      log("credential_refused", { agentId, reason: "no_site" });
      return;
    }
    const sent = hub.sendToComputer(agentId, {
      type: "credential_set",
      name,
      username: String(message.username ?? "").slice(0, 300),
      secret: secret.slice(0, 4000),
      site,
    });
    if (!sent) offline();
    log("credential_set", { agentId, name });
  },

  terminal_open({ hub, agentId, offline }, message) {
    const terminalId = cleanTerminalId(message.terminalId);
    if (!terminalId) return;
    if (!hub.sendToComputer(agentId, { type: "terminal_open", terminalId, cols: clampSize(message.cols, 20, 400, 80), rows: clampSize(message.rows, 5, 200, 24) })) offline();
    log("terminal_open", { agentId, terminalId });
  },

  terminal_input({ hub, agentId }, message) {
    const terminalId = cleanTerminalId(message.terminalId);
    const data = typeof message.data === "string" ? message.data.slice(0, 65536) : "";
    if (terminalId && data) hub.sendToComputer(agentId, { type: "terminal_input", terminalId, data });
  },

  terminal_resize({ hub, agentId }, message) {
    const terminalId = cleanTerminalId(message.terminalId);
    if (terminalId) hub.sendToComputer(agentId, { type: "terminal_resize", terminalId, cols: clampSize(message.cols, 20, 400, 80), rows: clampSize(message.rows, 5, 200, 24) });
  },

  terminal_close({ hub, agentId }, message) {
    const terminalId = cleanTerminalId(message.terminalId);
    if (terminalId) hub.sendToComputer(agentId, { type: "terminal_close", terminalId });
  },

  job_stop({ hub, agentId, offline }, message) {
    const jobId = typeof message.jobId === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(message.jobId) ? message.jobId : null;
    if (!jobId) return;
    if (!hub.sendToComputer(agentId, { type: "job_stop", jobId })) offline();
    log("job_stop", { agentId, jobId });
  },

  credential_delete({ hub, agentId, offline }, message) {
    const name = String(message.name ?? "").trim();
    if (!name) return;
    if (!hub.sendToComputer(agentId, { type: "credential_delete", name })) offline();
    log("credential_delete", { agentId, name });
  },
};

export function handleViewerMessage(ctx: ViewerContext, message: ViewerToServer) {
  const handler = viewerHandlers[message.type] as ((ctx: ViewerContext, message: ViewerToServer) => Promise<void> | void) | undefined;
  return handler?.(ctx, message);
}
