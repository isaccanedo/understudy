import { and, eq, sql } from "drizzle-orm";
import { normalizeRecipe, PROTOCOL_VERSION, type ComputerToServer } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/ids";
import { effectiveModel } from "@/lib/models";
import { messages as copy } from "@/lib/messages";
import type { Hub } from "../hub";
import { taskLink } from "../task-tools";
import { activeThread, relayActivity, relayAgentChat, streamDelta } from "../slack-threads";
import { log } from "./shared";
import { syncFiles, syncMemory } from "./snapshots";
import { reportRuleBlock } from "../rules";
import { computerProfile } from "../computer-profile";

type Handlers = {
  [K in ComputerToServer["type"]]: (hub: Hub, agentId: string, message: Extract<ComputerToServer, { type: K }>) => Promise<void> | void;
};

export const computerHandlers: Handlers = {
  async hello(hub, agentId, message) {
    if (message.version && message.version.split("/")[0] !== PROTOCOL_VERSION) {
      log("computer_version_mismatch", { agentId, version: message.version });
    }
    const db = getDb();
    await db.update(schema.agents).set({ brains: message.brains, lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(schema.agents.id, agentId));
    hub.broadcast(agentId, { type: "brains", brains: message.brains });
    hub.announceViewers(agentId);
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    const model = effectiveModel(agent?.model);
    if (agent && (model ?? "") !== (message.model ?? "")) hub.sendToComputer(agentId, { type: "set_model", model: model ?? "" });
    if (agent) hub.sendToComputer(agentId, { type: "set_rules", rules: agent.rules ?? [] });
    const profile = agent ? await computerProfile(agentId) : null;
    if (profile) hub.sendToComputer(agentId, profile);
    if (agent && !message.brains.some((b) => b.brain === agent.brain)) {
      if (agent.brain === "codex") {
        await db.update(schema.agents).set({ brain: "claude", updatedAt: new Date() }).where(eq(schema.agents.id, agentId));
      } else {
        hub.sendToComputer(agentId, { type: "set_brain", brain: agent.brain });
      }
    }
    await hub.inbound.flush(agentId);
  },

  frame(hub, agentId, message) {
    const frame = { jpegBase64: message.jpegBase64, width: message.width, height: message.height, url: message.url, ...(message.desktop ? { desktop: true } : {}) };
    hub.rememberFrame(agentId, frame);
    hub.broadcast(agentId, { type: "frame", ...frame });
  },

  async state(hub, agentId, message) {
    await getDb()
      .update(schema.agents)
      .set({ state: message.state, stateNote: message.note ?? null, updatedAt: new Date() })
      .where(eq(schema.agents.id, agentId));
    hub.broadcast(agentId, { type: "state", state: message.state, note: message.note ?? null });
  },

  async chat(hub, agentId, message) {
    if (message.roomId) return hub.rooms.agentSaid(agentId, message.roomId, String(message.text ?? ""));
    const text = String(message.text ?? "").slice(0, 8000);
    const thread = message.runId ? null : await activeThread(agentId);
    const streamId = message.runId ? undefined : message.streamId;
    await hub.addMessage(agentId, "agent", text, message.runId, undefined, thread ? "slack" : undefined, streamId);
    if (thread) relayAgentChat(agentId, text, streamId).catch((error) => log("slack_relay_error", { agentId, error: String(error) }));
  },

  async chat_delta(hub, agentId, message) {
    if (message.roomId) return hub.rooms.delta(agentId, message.roomId, message.streamId, String(message.text ?? "").slice(0, 8000));
    const text = String(message.text ?? "").slice(0, 8000);
    hub.broadcast(agentId, { type: "chat_delta", streamId: message.streamId, text });
    streamDelta(agentId, message.streamId, text).catch((error) => log("slack_stream_error", { agentId, error: String(error) }));
  },

  terminal_output(hub, agentId, message) {
    hub.sendToOwners(agentId, { type: "terminal_output", terminalId: message.terminalId, data: message.data });
  },

  async rule_blocked(hub, agentId, message) {
    let runId: string | null = null;
    if (message.runId) {
      const [run] = await getDb().select({ id: schema.runs.id }).from(schema.runs).where(and(eq(schema.runs.id, message.runId), eq(schema.runs.agentId, agentId)));
      runId = run?.id ?? null;
    }
    log("rule_blocked", { agentId, ruleId: message.ruleId, runId });
    await reportRuleBlock(hub, agentId, message.rule, message.detail, runId);
  },

  async watch_result(hub, agentId, message) {
    const outcome = await hub.watcher.result(agentId, message);
    log("watch_result", { agentId, watchId: message.watchId, outcome: outcome.kind });
  },

  jobs(hub, agentId, message) {
    hub.rememberJobs(agentId, message.jobs);
    hub.sendToOwners(agentId, { type: "jobs", jobs: message.jobs });
  },

  terminal_exit(hub, agentId, message) {
    hub.sendToOwners(agentId, { type: "terminal_exit", terminalId: message.terminalId, reason: message.reason });
    log("terminal_exit", { agentId, terminalId: message.terminalId });
  },

  async activity(hub, agentId, message) {
    const text = String(message.text ?? "").slice(0, 2000);
    if (message.roomId) return hub.rooms.activity(agentId, message.roomId, text);
    await hub.addMessage(agentId, "activity", text, message.runId);
    relayActivity(agentId, text).catch((error) => log("slack_status_error", { agentId, error: String(error) }));
  },

  async recorded(hub, agentId, message) {
    const db = getDb();
    const event = message.event.kind === "screenshot" ? { ...message.event, jpegBase64: "" } : message.event;
    if (JSON.stringify(event).length > 64 * 1024) return;
    const exists = await db
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(and(eq(schema.recordings.id, message.recordingId), eq(schema.recordings.agentId, agentId), eq(schema.recordings.status, "recording")));
    if (exists.length === 0) return;
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${schema.recordedEvents.seq}), 0) + 1` })
      .from(schema.recordedEvents)
      .where(eq(schema.recordedEvents.recordingId, message.recordingId));
    await db.insert(schema.recordedEvents).values({ id: newId("evt"), recordingId: message.recordingId, seq: Number(next), event });
    hub.broadcast(agentId, { type: "recorded", recordingId: message.recordingId, seq: Number(next), event: message.event });
  },

  async recipe(hub, agentId, message) {
    const saved = await hub.recordings.saveRecipe(agentId, message.recordingId, normalizeRecipe(message.recipe));
    if (!saved) return;
    hub.broadcast(agentId, { type: "recipe", recordingId: message.recordingId, recipeId: saved.id, recipe: saved.recipe });
    hub.broadcast(agentId, { type: "recording", recordingId: message.recordingId, status: "done" });
    if (saved.source === "chat") await hub.addMessage(agentId, "system", copy.teach.savedFromChat(saved.recipe.title, taskLink(agentId, saved.id)));
  },

  async recipe_failed(hub, agentId, message) {
    await hub.recordings.fail(agentId, message.recordingId);
    hub.broadcast(agentId, { type: "recording", recordingId: message.recordingId, status: "failed" });
    hub.broadcast(agentId, { type: "recipe_failed", recordingId: message.recordingId, error: message.error });
    await hub.addMessage(agentId, "system", copy.teach.failed(message.error));
  },

  async approval_request(hub, agentId, message) {
    const request = message.request;
    await hub.approvals.create(
      agentId,
      {
        id: String(request.id ?? "").slice(0, 200),
        runId: request.runId ? String(request.runId).slice(0, 100) : undefined,
        stepId: request.stepId ? String(request.stepId).slice(0, 100) : undefined,
        summary: String(request.summary ?? "").slice(0, 500),
        fields: (request.fields ?? []).slice(0, 50).map((f) => ({ label: String(f.label).slice(0, 200), value: String(f.value).slice(0, 20000) })),
      },
      "computer",
    );
  },

  async run_finished(hub, agentId, message) {
    await hub.runs.finish(agentId, message.runId, message.ok, message.summary, message.usage);
  },

  async run_record(hub, agentId, message) {
    await hub.runs.saveRecord(agentId, message.runId, message.steps, message.unusual ?? []);
    hub.broadcast(agentId, { type: "run_record", runId: message.runId });
  },

  login_prompt(hub, agentId, message) {
    hub.broadcast(agentId, { type: "login_prompt", brain: message.brain, url: message.url, code: message.code, message: message.message });
  },

  async login_done(hub, agentId, message) {
    const db = getDb();
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    if (agent) {
      const brains = [...agent.brains.filter((b) => b.brain !== message.brain), { brain: message.brain, loggedIn: message.ok, account: message.account }];
      await db.update(schema.agents).set({ brains, updatedAt: new Date() }).where(eq(schema.agents.id, agentId));
      hub.broadcast(agentId, { type: "brains", brains });
    }
    hub.broadcast(agentId, { type: "login_done", brain: message.brain, ok: message.ok, account: message.account, message: message.message });
  },

  async files(hub, agentId, message) {
    await syncFiles(agentId, message.files);
    hub.broadcast(agentId, { type: "files", files: message.files });
  },

  upload_state(hub, agentId, message) {
    hub.answerAsk(agentId, message);
  },

  upload_done(hub, agentId, message) {
    hub.answerAsk(agentId, message);
  },

  file_chunk(hub, agentId, message) {
    hub.answerAsk(agentId, message);
  },

  file_shared(hub, agentId, message) {
    hub.answerAsk(agentId, message);
  },

  artifact_rendered(hub, agentId, message) {
    hub.answerAsk(agentId, message);
  },

  file_content(hub, agentId, message) {
    hub.resolveFile(agentId, message.requestId, { base64: message.base64, error: message.error });
  },

  async credentials(hub, agentId, message) {
    const credentials = message.credentials.slice(0, 200).map((c) => ({ name: c.name, username: c.username, site: c.site }));
    await getDb().update(schema.agents).set({ credentials, updatedAt: new Date() }).where(eq(schema.agents.id, agentId));
    hub.broadcast(agentId, { type: "credentials", credentials });
  },

  async memory(hub, agentId, message) {
    await syncMemory(agentId, message.files);
    hub.broadcast(agentId, { type: "memory", files: message.files });
  },

  async room_turn_done(hub, agentId, message) {
    await hub.rooms.turnDone(agentId, message.roomId, message.ok, message.error);
  },

  pong() {},
};

export function handleComputerMessage(hub: Hub, agentId: string, message: ComputerToServer) {
  const handler = computerHandlers[message.type] as (hub: Hub, agentId: string, message: ComputerToServer) => Promise<void> | void;
  return handler(hub, agentId, message);
}
