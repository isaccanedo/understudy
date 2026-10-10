import { z } from "zod";
import { ArtifactEditContextSchema } from "./artifacts.ts";
import { AttachmentSchema, MAX_ATTACHMENTS } from "./files.ts";

const text = z.string();
const id = z.string().min(1).max(200);
const time = z.number().finite();
const optionalText = z.string().optional();
const chunkData = z.string().max(12 * 1024 * 1024);
const fileError = z.string().max(300).optional();
const byteCount = z.number().int().min(0);

export const AgentStateSchema = z.enum(["calm", "working", "waiting_you", "stuck", "listening", "thinking", "done"]);
export const BrainSchema = z.enum(["claude", "codex"]);
export const StepModeSchema = z.enum(["auto", "ask"]);

export const RecordedEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), at: time, url: text, title: optionalText }),
  z.object({ kind: z.literal("click"), at: time, url: text, selector: text, label: text, x: z.number(), y: z.number() }),
  z.object({ kind: z.literal("input"), at: time, url: text, selector: text, label: text, value: text, masked: z.boolean() }),
  z.object({ kind: z.literal("select"), at: time, url: text, selector: text, label: text, value: text }),
  z.object({ kind: z.literal("key"), at: time, url: text, key: text }),
  z.object({ kind: z.literal("request"), at: time, method: text, url: text, status: z.number().optional(), contentType: optionalText }),
  z.object({ kind: z.literal("narration"), at: time, text }),
  z.object({ kind: z.literal("screenshot"), at: time, jpegBase64: text }),
]);

export const RecipeStepSchema = z.object({ id: text, text, detail: optionalText, mode: StepModeSchema });
export const RecipeQuestionSchema = z.object({ id: text, text, options: z.array(text), answer: optionalText });
export const RecipeSchema = z.object({
  title: text,
  trigger: text,
  steps: z.array(RecipeStepSchema),
  questions: z.array(RecipeQuestionSchema),
  askFirstRuns: z.number(),
});

export const ApprovalRequestSchema = z.object({
  id: text,
  runId: text,
  stepId: optionalText,
  summary: text,
  fields: z.array(z.object({ label: text, value: text })),
});

export const MemoryFileSchema = z.object({ path: text, text, updatedAt: time });
export const RunStepSchema = z.object({ at: time, text, screenshotJpegBase64: optionalText, approvalId: optionalText });
export const UsageSchema = z.object({ inputTokens: z.number(), outputTokens: z.number(), costUsd: z.number().optional() });
export const JobInfoSchema = z.object({
  id,
  name: text,
  command: text,
  status: z.enum(["running", "done", "failed", "stopped"]),
  startedAt: time,
  finishedAt: time.optional(),
  exitCode: z.number().int().nullable().optional(),
});
export const OwnerRuleSchema = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("max_amount"), amount: z.number().positive().max(1e12), currency: z.string().max(8).optional() }),
  z.object({ id, kind: z.literal("allowed_email_domains"), domains: z.array(z.string().min(3).max(200)).min(1).max(20) }),
  z.object({ id, kind: z.literal("blocked_site"), site: z.string().min(3).max(200) }),
  z.object({ id, kind: z.literal("custom"), text: z.string().min(1).max(300) }),
]);
export const FileEntrySchema = z.object({ path: text, size: z.number(), updatedAt: time });
export const BrainStatusSchema = z.object({ brain: BrainSchema, loggedIn: z.boolean(), account: optionalText });
export const CredentialInfoSchema = z.object({ name: text, username: text, site: optionalText });

export const ComputerToServerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), agentId: text, version: text, build: optionalText, brains: z.array(BrainStatusSchema), model: optionalText }),
  z.object({ type: z.literal("frame"), jpegBase64: text, width: z.number(), height: z.number(), url: text, desktop: z.boolean().optional() }),
  z.object({ type: z.literal("state"), state: AgentStateSchema, note: optionalText }),
  z.object({ type: z.literal("chat"), runId: optionalText, role: z.literal("understudy"), text, streamId: id.optional(), roomId: id.optional() }),
  z.object({ type: z.literal("chat_delta"), streamId: id, text: z.string().max(64 * 1024), roomId: id.optional() }),
  z.object({ type: z.literal("activity"), runId: optionalText, text, roomId: id.optional() }),
  z.object({ type: z.literal("room_turn_done"), roomId: id, ok: z.boolean(), error: z.string().max(500).optional() }),
  z.object({ type: z.literal("recorded"), recordingId: id, event: RecordedEventSchema }),
  z.object({ type: z.literal("recipe"), recordingId: id, recipe: RecipeSchema }),
  z.object({ type: z.literal("recipe_failed"), recordingId: id, error: text }),
  z.object({ type: z.literal("approval_request"), request: ApprovalRequestSchema }),
  z.object({ type: z.literal("run_finished"), runId: id, ok: z.boolean(), summary: text, usage: UsageSchema.optional() }),
  z.object({ type: z.literal("run_record"), runId: id, steps: z.array(RunStepSchema), unusual: z.array(text).optional() }),
  z.object({ type: z.literal("login_prompt"), brain: BrainSchema, url: optionalText, code: optionalText, message: text }),
  z.object({ type: z.literal("login_done"), brain: BrainSchema, ok: z.boolean(), account: optionalText, message: optionalText }),
  z.object({ type: z.literal("memory"), files: z.array(MemoryFileSchema) }),
  z.object({ type: z.literal("files"), files: z.array(FileEntrySchema) }),
  z.object({ type: z.literal("file_content"), requestId: id, path: text, base64: optionalText, error: optionalText }),
  z.object({ type: z.literal("credentials"), credentials: z.array(CredentialInfoSchema) }),
  z.object({ type: z.literal("terminal_output"), terminalId: id, data: text }),
  z.object({ type: z.literal("terminal_exit"), terminalId: id, reason: optionalText }),
  z.object({ type: z.literal("jobs"), jobs: z.array(JobInfoSchema).max(100) }),
  z.object({ type: z.literal("rule_blocked"), ruleId: id, rule: text, detail: text, runId: id.optional() }),
  z.object({ type: z.literal("watch_result"), watchId: id, hash: z.string().max(128).optional(), text: z.string().max(60 * 1024).optional(), error: z.string().max(500).optional() }),
  z.object({ type: z.literal("upload_state"), requestId: id, uploadId: id, received: byteCount, free: byteCount.optional(), error: fileError }),
  z.object({ type: z.literal("upload_done"), requestId: id, uploadId: id, attachment: AttachmentSchema.optional(), error: fileError }),
  z.object({ type: z.literal("file_chunk"), requestId: id, size: byteCount.optional(), base64: chunkData.optional(), error: fileError }),
  z.object({ type: z.literal("file_shared"), requestId: id, attachment: AttachmentSchema.optional(), error: fileError }),
  z.object({ type: z.literal("artifact_rendered"), requestId: id, key: z.string().regex(/^[a-f0-9]{32}$/).optional(), pages: z.number().int().min(0).max(1000).optional(), error: fileError }),
  z.object({ type: z.literal("pong"), at: time }),
]);

export const InputEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mouse"),
    action: z.enum(["move", "down", "up", "wheel"]),
    x: z.number(),
    y: z.number(),
    button: z.enum(["left", "right"]).optional(),
    deltaY: z.number().optional(),
  }),
  z.object({ kind: z.literal("key"), action: z.enum(["down", "up", "char"]), key: text, code: optionalText, text: optionalText }),
  z.object({ kind: z.literal("navigate"), url: text }),
]);

export const ServerToComputerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat"), text, from: text, fromAgent: z.object({ id: id, name: text }).optional(), model: optionalText, attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS).optional(), artifactEdit: ArtifactEditContextSchema.optional() }),
  z.object({ type: z.literal("room_turn"), roomId: id, prompt: z.string().max(64 * 1024), model: optionalText }),
  z.object({ type: z.literal("input"), event: InputEventSchema }),
  z.object({ type: z.literal("record_start"), recordingId: id }),
  z.object({ type: z.literal("record_narration"), recordingId: id, text }),
  z.object({ type: z.literal("record_stop"), recordingId: id }),
  z.object({
    type: z.literal("run_recipe"),
    runId: id,
    recipe: RecipeSchema,
    approvalsRequired: z.boolean(),
    context: optionalText,
    webhook: z.boolean().optional(),
    model: optionalText,
  }),
  z.object({ type: z.literal("approval_answer"), requestId: id, approved: z.boolean(), note: optionalText }),
  z.object({ type: z.literal("login_start"), brain: BrainSchema }),
  z.object({ type: z.literal("login_code"), brain: BrainSchema, code: text }),
  z.object({ type: z.literal("set_brain"), brain: BrainSchema }),
  z.object({ type: z.literal("set_model"), model: z.string().max(100) }),
  z.object({ type: z.literal("terminal_open"), terminalId: id, cols: z.number().int().min(20).max(400), rows: z.number().int().min(5).max(200) }),
  z.object({ type: z.literal("terminal_input"), terminalId: id, data: z.string().max(65536) }),
  z.object({ type: z.literal("terminal_resize"), terminalId: id, cols: z.number().int().min(20).max(400), rows: z.number().int().min(5).max(200) }),
  z.object({ type: z.literal("terminal_close"), terminalId: id }),
  z.object({ type: z.literal("job_stop"), jobId: id }),
  z.object({ type: z.literal("set_rules"), rules: z.array(OwnerRuleSchema).max(30) }),
  z.object({ type: z.literal("watch_check"), watchId: id, url: z.string().min(1).max(2000), part: z.string().max(300).optional() }),
  z.object({ type: z.literal("viewers"), count: z.number().int().min(0) }),
  z.object({ type: z.literal("memory_write"), path: text, text }),
  z.object({ type: z.literal("memory_delete"), path: text }),
  z.object({ type: z.literal("file_put"), path: text, base64: text }),
  z.object({ type: z.literal("file_get"), requestId: id, path: text }),
  z.object({ type: z.literal("upload_open"), requestId: id, uploadId: id, name: z.string().min(1).max(255), size: byteCount }),
  z.object({ type: z.literal("upload_chunk"), requestId: id, uploadId: id, offset: byteCount, base64: chunkData }),
  z.object({ type: z.literal("upload_finish"), requestId: id, uploadId: id }),
  z.object({ type: z.literal("upload_cancel"), uploadId: id }),
  z.object({ type: z.literal("file_read"), requestId: id, path: z.string().min(1).max(600), offset: byteCount, length: byteCount }),
  z.object({ type: z.literal("file_thumb"), requestId: id, path: z.string().min(1).max(600) }),
  z.object({ type: z.literal("file_share"), requestId: id, path: z.string().min(1).max(1000) }),
  z.object({ type: z.literal("artifact_render"), requestId: id, path: z.string().min(1).max(600) }),
  z.object({ type: z.literal("artifact_page"), requestId: id, key: z.string().regex(/^[a-f0-9]{32}$/), page: z.number().int().min(1).max(1000) }),
  z.object({ type: z.literal("teach_text"), recordingId: id, text }),
  z.object({ type: z.literal("teach_recording"), recordingId: id, events: z.array(RecordedEventSchema).max(5000), ownerBrowser: z.boolean().optional() }),
  z.object({ type: z.literal("credential_set"), name: text, username: text, secret: text, site: optionalText }),
  z.object({ type: z.literal("credential_delete"), name: text }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("ping"), at: time }),
  z.object({
    type: z.literal("profile"),
    name: z.string().max(100),
    ownerName: z.string().max(100).optional(),
    look: z.object({ body: z.string().max(40), color: z.string().max(20), eyes: z.string().max(40), acc: z.string().max(40).optional(), accColor: z.string().max(20).optional() }),
  }),
]);

export const ComputerSpecSchema = z.object({ agentId: id, token: z.string().min(1), image: text, serverUrl: z.string().min(1) });

export const HostToServerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("host_hello"), hostId: text, capacity: z.number(), running: z.array(text), build: optionalText }),
  z.object({
    type: z.literal("computer_status"),
    agentId: id,
    status: z.enum(["starting", "running", "stopped", "failed"]),
    message: optionalText,
  }),
]);

export const ServerToHostSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("computer_ensure"), spec: ComputerSpecSchema }),
  z.object({ type: z.literal("computer_stop"), agentId: id }),
  z.object({ type: z.literal("computer_destroy"), agentId: id }),
]);

export type Parsed<T> = { ok: true; message: T } | { ok: false; error: string };

function parser<S extends z.ZodType>(schema: S) {
  return (raw: unknown): Parsed<z.infer<S>> => {
    let value = raw;
    if (typeof raw === "string" || raw instanceof Uint8Array) {
      try {
        value = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      } catch {
        return { ok: false, error: "not JSON" };
      }
    }
    const result = schema.safeParse(value);
    if (result.success) return { ok: true, message: result.data };
    const first = result.error.issues[0];
    return { ok: false, error: first ? `${first.path.join(".") || "message"}: ${first.message}` : "invalid message" };
  };
}

export const parseComputerToServer = parser(ComputerToServerSchema);
export const parseServerToComputer = parser(ServerToComputerSchema);
export const parseHostToServer = parser(HostToServerSchema);
export const parseServerToHost = parser(ServerToHostSchema);
