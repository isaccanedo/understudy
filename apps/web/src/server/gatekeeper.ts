import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { argsSubject, describeRule, findViolation, formatBytes } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import type { AgentTools } from "@/lib/db/schema";
import { brainText } from "@/lib/brain-text";
import { hashToken, newId } from "@/lib/ids";
import type { ComputerReply, Hub } from "./hub";
import { approvalFields, MAX_APPROVAL_FIELDS, payloadHash, serverAllowedFor } from "./approval-payload";
import { publishArtifact } from "./artifacts/service";
import { teamTools } from "./team";
import { taskTools } from "./task-tools";
import { reportRuleBlock } from "./rules";
import { agentIdentity, slackEnabled, slackUserIdFor } from "./slack";
import { slackApi, slackMode, slackTools, type GuardInput, type GuardResult } from "./slack-tools";
import { callUpstreamTool, listUpstreamTools, loadServers, type UpstreamServer } from "./upstream";

const APPROVAL_LIFETIME_SECONDS = 24 * 60 * 60;
const APPROVAL_CALL_CAP_MS = 30 * 60 * 1000;
const ACTION_APPROVAL_MAX_AGE_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 20_000;

type AgentRow = typeof schema.agents.$inferSelect;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function decision(approved: boolean, note: string | undefined, requestId: string, stopped = false): ToolResult {
  const verdict = approved ? "approved" : stopped ? "stopped" : "denied";
  return text(`${note ? `${verdict}: ${note}` : verdict} [requestId: ${requestId}]`);
}

type Outcome = { kind: "unknown" } | { kind: "pending" } | { kind: "decided"; approved: boolean; note?: string; stopped?: boolean };

const MAX_BODY_BYTES = 1024 * 1024;

function outcomeText(id: string, outcome: Outcome): ToolResult {
  if (outcome.kind === "unknown") return text("denied: unknown request");
  if (outcome.kind === "pending") return text(JSON.stringify({ status: "pending", requestId: id }));
  return decision(outcome.approved, outcome.note, id, outcome.stopped);
}

export function ownerSlackNote(error: string | undefined) {
  if (error === "user_not_found") return brainText.ownerSlackMissing;
  if (error === "slack_disabled") return brainText.ownerSlackOff;
  return brainText.ownerSlackFailed(error ?? "unknown error");
}

function text(value: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], isError };
}

async function logCall(agentId: string, tool: string, args: unknown, result: unknown, ok: boolean) {
  await getDb().insert(schema.toolCalls).values({ id: newId("tc"), agentId, tool, args, result, ok });
  console.log(JSON.stringify({ at: new Date().toISOString(), event: "gatekeeper_call", agentId, tool, ok }));
}

export function actionToolName(tool: string) {
  return tool.trim().replace(/^mcp__gatekeeper__/, "");
}

export function actionHash(tool: string, args: Record<string, unknown>) {
  return payloadHash(`action:${actionToolName(tool)}`, args);
}

type Extra = {
  call?: { name: string };
  signal: AbortSignal;
  sendNotification: (notification: { method: "notifications/message"; params: { level: "info"; data: unknown } }) => Promise<void>;
};

export function toolsEnabled(tools: AgentTools) {
  return {
    request_approval: true,
    wait_for_approval: true,
    notify_owner: tools.notifyOwner,
  };
}

type Builtin = {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (args: never, extra: Extra) => Promise<ToolResult>;
};

const PROXY_SEPARATOR = "__";

function jsonSchemaOf(schema: z.ZodType) {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest as { type: "object"; [key: string]: unknown };
}

async function buildServer(hub: Hub, agent: AgentRow, ownerEmail: string) {
  const server = new Server({ name: "understudy-gatekeeper", version: "1.0.0" }, { capabilities: { tools: {}, logging: {} } });
  const enabled = toolsEnabled(agent.tools);
  const askTools = new Set(agent.tools.askTools ?? []);

  const waitOutcome = async (id: string, extra: Extra): Promise<Outcome> => {
    const heartbeat = setInterval(() => {
      extra
        .sendNotification({ method: "notifications/message", params: { level: "info", data: "waiting for owner" } })
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    try {
      const existing = await hub.approvalOutcome(id, agent.id);
      if (!existing) return { kind: "unknown" };
      if (existing.status === "expired") return { kind: "decided", approved: false, note: brainText.expiredNote };
      if (existing.status === "cancelled") return { kind: "decided", approved: false, note: brainText.stoppedNote, stopped: true };
      if (existing.status !== "pending") return { kind: "decided", approved: existing.status === "approved", note: existing.note ?? undefined };
      const answer = await hub.waitForApproval(id, APPROVAL_CALL_CAP_MS);
      if (!answer) return { kind: "pending" };
      return { kind: "decided", approved: answer.approved, note: answer.note, stopped: answer.status === "cancelled" };
    } finally {
      clearInterval(heartbeat);
    }
  };

  const waitWithHeartbeat = async (id: string, extra: Extra) => outcomeText(id, await waitOutcome(id, extra));

  const builtins: Builtin[] = [
    {
      name: "request_approval",
      description:
        'Ask your owner to approve a step that cannot be undone, before doing it. Returns "approved" or "denied" (with an optional note from the owner). If it returns {"status":"pending","requestId":...}, the owner has not answered yet: call wait_for_approval with that requestId and keep waiting. Never do the step unless the answer is approved. When the step is one call to another gatekeeper tool during a task run, pass it as action (tool name and the exact arguments) together with runId: the owner sees exactly that call, and once approved, that one call with exactly those arguments goes through without asking again.',
      schema: z.object({
        summary: z.string().min(1).max(500),
        fields: z.array(z.object({ label: z.string().max(200), value: z.string().max(20000) })).max(50).optional(),
        runId: z.string().optional(),
        stepId: z.string().optional(),
        action: z.object({ tool: z.string().min(1).max(200), args: z.record(z.string(), z.unknown()) }).optional(),
      }),
      run: (async (
        args: { summary: string; fields?: { label: string; value: string }[]; runId?: string; stepId?: string; action?: { tool: string; args: Record<string, unknown> } },
        extra: Extra,
      ) => {
        let fields = args.fields ?? [];
        let hash: string | undefined;
        if (args.action) {
          const tool = actionToolName(args.action.tool);
          if (!actionAllowed(tool)) return text(`not asked: ${tool} is not one of your gatekeeper tools; ask without action`, true);
          const shown = approvalFields(args.action.args);
          if ("error" in shown) return text(`not asked: an action needs ${shown.error}, so the owner sees exactly what will run`, true);
          fields = [...fields, { label: "Action", value: tool }, ...shown.fields];
          if (fields.length > MAX_APPROVAL_FIELDS) return text(`not asked: at most ${MAX_APPROVAL_FIELDS} fields and action arguments together`, true);
          hash = actionHash(tool, args.action.args);
        }
        const id = await hub.createApproval(
          agent.id,
          { summary: args.summary, fields, runId: args.runId || undefined, stepId: args.stepId },
          "mcp",
          APPROVAL_LIFETIME_SECONDS,
          hash,
        );
        return waitWithHeartbeat(id, extra);
      }) as Builtin["run"],
    },
    {
      name: "wait_for_approval",
      description: "Keep waiting for an approval that came back pending. Returns approved, denied, or pending again.",
      schema: z.object({ requestId: z.string().min(1) }),
      run: (async (args: { requestId: string }, extra: Extra) => waitWithHeartbeat(args.requestId, extra)) as Builtin["run"],
    },
  ];

  builtins.push({
    name: "share_file",
    description:
      "Send a file from your computer to your owner in the chat, as a card with a preview (images, video and audio players, PDFs, text and code) and a download button. Use it for anything you made or found for your owner. path: the file on your computer (absolute, ~/..., or relative to ~/files); files outside ~/files/inbox and ~/files/outbox are copied into ~/files/outbox first. caption: an optional short message shown with the file.",
    schema: z.object({ path: z.string().min(1).max(1000), caption: z.string().max(4000).optional() }),
    run: (async (args: { path: string; caption?: string }) => {
      const result = await hub.askComputer<Extract<ComputerReply, { type: "file_shared" }>>(agent.id, { type: "file_share", requestId: newId("share"), path: args.path }, 10 * 60 * 1000);
      if (result.type === "failed") return text(`not shared: ${result.error === "offline" ? "your computer is not connected to the panel" : "the copy took too long"}`, true);
      if (result.error || !result.attachment) return text(`not shared: ${result.error ?? "unknown error"}`, true);
      await hub.addMessage(agent.id, "agent", (args.caption ?? "").trim().slice(0, 4000), null, undefined, undefined, undefined, [result.attachment]);
      return text(`shared "${result.attachment.name}" (${formatBytes(result.attachment.size)}) with your owner; it is in the chat as ~/files/${result.attachment.path}. Do not paste its contents again.`);
    }) as Builtin["run"],
  });

  builtins.push({
    name: "publish_artifact",
    description:
      "Show your owner something you made, beside the chat, in a viewer with pages, zoom, download and every version kept. Use it for anything meant to be looked at: a slide deck, a document, a report, a web page, a chart, a small interactive app, a PDF or an image. Supported: one self-contained .html file (it runs isolated, with no network: inline your data, scripts and styles may only load from cdnjs.cloudflare.com, cdn.jsdelivr.net or unpkg.com, and localStorage, cookies, fetch, forms, popups and links that leave the page do not work), .md, .pdf, .pptx, .docx, .xlsx (shown as pages) and images (.png, .jpg, .webp, .gif, .svg). path: the file on your computer. title: a short human name. To change an artifact, edit the file and call this again with its artifact_id; that adds a new version. note: one short line saying what this version is or what changed.",
    schema: z.object({
      path: z.string().min(1).max(1000),
      title: z.string().min(1).max(200),
      artifact_id: z.string().max(100).optional(),
      note: z.string().max(1000).optional(),
    }),
    run: (async (args: { path: string; title: string; artifact_id?: string; note?: string }) => {
      const result = await publishArtifact(hub, agent.id, { path: args.path, title: args.title, artifactId: args.artifact_id?.trim() || undefined, note: args.note });
      if (!result.ok) return text(`not published: ${result.error}`, true);
      await hub.addMessage(agent.id, "agent", "", null, undefined, undefined, undefined, undefined, result.card);
      return text(
        `published "${result.card.title}" as artifact_id ${result.artifactId}, version ${result.version}. Your owner sees it beside the chat, so do not paste its contents. To change it, edit the file and call publish_artifact again with artifact_id ${result.artifactId}.`,
      );
    }) as Builtin["run"],
  });

  if (enabled.notify_owner) {
    builtins.push({
      name: "notify_owner",
      description:
        "Send a short message to your owner. It always lands in your chat with them in the panel and, when Slack is on, as a Slack direct message to them. This is how you reach your owner: you never need their Slack name, email or ID. Does not wait for an answer.",
      schema: z.object({ text: z.string().min(1).max(2000) }),
      run: (async (args: { text: string }) => {
        const result = await hub.notifyOwner(agent.id, args.text);
        if (result.slack) return text({ delivered: true, slack: true });
        return text({ delivered: true, slack: false, note: ownerSlackNote(result.error) });
      }) as Builtin["run"],
    });
  }

  builtins.push(...(teamTools(hub, agent) as Builtin[]));
  builtins.push(...(taskTools(hub, agent) as Builtin[]));

  const guard = (input: GuardInput) =>
    guardOutward(hub, agent, input.target, input.summary, input.fields, input.args, input.ask, waitOutcome, input.extra as Extra);

  if (await slackEnabled()) {
    builtins.push(
      ...(slackTools({
        agent: { id: agent.id, name: agent.name, iconUrl: agentIdentity(agent).iconUrl },
        owner: () => slackUserIdFor({ id: agent.ownerId, email: ownerEmail }),
        mode: slackMode(agent.tools),
        api: slackApi(),
        guard,
        fetchFile: (path) => hub.requestFile(agent.id, path),
      }) as Builtin[]),
    );
  }

  const upstreams = (await loadServers(agent.tools.servers ?? [])).filter((server) => serverAllowedFor(server.allowedEmails, ownerEmail));
  const needsApproval = (upstream: UpstreamServer, toolName: string) =>
    upstream.askAll || (upstream.askTools ?? []).includes(toolName) || askTools.has(`${upstream.id}:${toolName}`);
  const actionAllowed = (tool: string) =>
    tool !== "request_approval" && tool !== "wait_for_approval" && (builtins.some((b) => b.name === tool) || upstreams.some((u) => tool.startsWith(`${u.slug}${PROXY_SEPARATOR}`)));

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const proxied = await Promise.all(
      upstreams.map(async (upstream) => {
        try {
          const tools = await listUpstreamTools(upstream, agent.ownerId);
          return tools.map((tool) => ({
            name: `${upstream.slug}${PROXY_SEPARATOR}${tool.name}`,
            description: `[${upstream.name}] ${tool.description ?? ""}${needsApproval(upstream, tool.name) ? " (the owner approves every call; it may take a while)" : ""}`.trim(),
            inputSchema: tool.inputSchema,
          }));
        } catch (error) {
          console.error(JSON.stringify({ event: "upstream_list_error", server: upstream.slug, error: String(error) }));
          return [];
        }
      }),
    );
    return {
      tools: [
        ...builtins.map((b) => ({ name: b.name, description: b.description, inputSchema: jsonSchemaOf(b.schema) })),
        ...proxied.flat(),
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const builtin = builtins.find((b) => b.name === name);
    const callExtra = { ...(extra as unknown as Extra), call: { name } };
    try {
      let result: ToolResult;
      if (builtin) {
        const parsed = builtin.schema.safeParse(args);
        result = parsed.success ? await builtin.run(parsed.data as never, callExtra) : text(parsed.error.message, true);
      } else {
        const [slug, ...rest] = name.split(PROXY_SEPARATOR);
        const toolName = rest.join(PROXY_SEPARATOR);
        const upstream = upstreams.find((u) => u.slug === slug);
        if (!upstream || !toolName) {
          result = text(`unknown tool ${name}`, true);
        } else {
          result = await proxyCall(hub, agent, upstream, toolName, args, needsApproval(upstream, toolName), waitOutcome, callExtra);
        }
      }
      await logCall(agent.id, name, args, result.content[0]?.text?.slice(0, 4000), !result.isError);
      return result;
    } catch (error) {
      await logCall(agent.id, name, args, String(error), false);
      return text(String(error), true);
    }
  });

  return server;
}

async function guardOutward(
  hub: Hub,
  agent: AgentRow,
  target: string,
  summary: string,
  fields: { label: string; value: string }[],
  args: Record<string, unknown>,
  ask: boolean,
  waitOutcome: (id: string, extra: Extra) => Promise<Outcome>,
  extra: Extra,
): Promise<GuardResult> {
  const violation = findViolation(agent.rules ?? [], argsSubject(args));
  if (violation) {
    const rule = describeRule(violation.rule);
    await reportRuleBlock(hub, agent.id, rule, violation.reason).catch(() => {});
    return { ok: false, text: `not done: blocked by your owner's rule "${rule}": ${violation.reason}. Do not try another way; stop and tell your owner.` };
  }
  if (!ask) return { ok: true };
  if (extra.call && (await hub.useActionApproval(agent.id, actionHash(extra.call.name, args), ACTION_APPROVAL_MAX_AGE_MS))) return { ok: true };
  const hash = payloadHash(target, args);
  const id = await hub.createApproval(agent.id, { summary, fields }, "mcp", APPROVAL_LIFETIME_SECONDS, hash);
  let outcome = await waitOutcome(id, extra);
  while (outcome.kind === "pending" && !extra.signal?.aborted) outcome = await waitOutcome(id, extra);
  if (outcome.kind !== "decided" || !outcome.approved) return { ok: false, text: `not done: the owner ${outcomeText(id, outcome).content[0].text}` };
  const approvedHash = await hub.approvalPayloadHash(id, agent.id);
  if (!approvedHash || approvedHash !== payloadHash(target, args)) return { ok: false, text: "not done: the arguments differ from what the owner approved" };
  return { ok: true };
}

async function proxyCall(
  hub: Hub,
  agent: AgentRow,
  upstream: UpstreamServer,
  toolName: string,
  args: Record<string, unknown>,
  needsApproval: boolean,
  waitOutcome: (id: string, extra: Extra) => Promise<Outcome>,
  extra: Extra,
): Promise<ToolResult> {
  const shown = needsApproval ? approvalFields(args) : { fields: [] };
  if ("error" in shown) {
    return text(`not called: calls that need approval need ${shown.error}, so the owner sees exactly what will run`, true);
  }
  const allowed = await guardOutward(hub, agent, `${upstream.id}:${toolName}`, `${upstream.name}: ${toolName}`, [...shown.fields], args, needsApproval, waitOutcome, extra);
  if (!allowed.ok) return text(allowed.text.replace(/^not done:/, "not called:"), true);
  const result = await callUpstreamTool(upstream, toolName, args, agent.ownerId);
  const content = Array.isArray(result.content) ? result.content : [];
  const parts = content.map((part: { type: string; text?: string }) => (part.type === "text" ? part.text ?? "" : JSON.stringify(part)));
  return text(parts.join("\n") || JSON.stringify(result), Boolean(result.isError));
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function reject(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

export async function authenticateComputer(authorization: string | undefined) {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;
  const [row] = await getDb()
    .select({ agent: schema.agents, ownerStatus: schema.user.status, ownerEmail: schema.user.email })
    .from(schema.agents)
    .innerJoin(schema.user, eq(schema.user.id, schema.agents.ownerId))
    .where(eq(schema.agents.tokenHash, hashToken(token)));
  if (!row || row.ownerStatus !== "approved") return null;
  return { ...row.agent, ownerEmail: row.ownerEmail };
}

export async function handleGatekeeper(hub: Hub, req: IncomingMessage, res: ServerResponse) {
  const agent = await authenticateComputer(req.headers.authorization);
  if (!agent) return reject(res, 401, "unauthorized");
  if (req.method !== "POST") return reject(res, 405, "method not allowed");
  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    return reject(res, 400, "invalid json");
  }
  const server = await buildServer(hub, agent, agent.ownerEmail);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
