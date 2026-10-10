import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { messages as copy } from "@/lib/messages";
import { agentIdentity, escapeSlack, postMessage, slackCall, type SlackIdentity } from "./slack";

export const THREAD_WINDOW_MS = 30 * 60 * 1000;
const MARKDOWN_LIMIT = 11_900;
const FALLBACK_LIMIT = 3_900;

export type SlackThread = typeof schema.slackThreads.$inferSelect;

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

export function markdownBlocks(text: string) {
  return [{ type: "markdown", text: text.slice(0, MARKDOWN_LIMIT) }];
}

export function plainFallback(text: string) {
  return text
    .replace(/```[a-z]*\n?/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .slice(0, FALLBACK_LIMIT);
}

export function statusFromActivity(text: string) {
  const clean = text.replace(/\s+/g, " ").trim().replace(/[.…]+$/, "");
  if (!clean) return "is working…";
  const lowered = clean.charAt(0).toLowerCase() + clean.slice(1);
  return `is ${lowered}`.slice(0, 80) + "…";
}

export async function setThread(agentId: string, input: { channel: string; threadTs?: string; assistant: boolean; slackUser?: string; slackTeam?: string }) {
  const expiresAt = new Date(Date.now() + THREAD_WINDOW_MS);
  const people = { ...(input.slackUser ? { slackUser: input.slackUser } : {}), ...(input.slackTeam ? { slackTeam: input.slackTeam } : {}) };
  await getDb()
    .insert(schema.slackThreads)
    .values({ agentId, channel: input.channel, threadTs: input.threadTs ?? null, assistant: input.assistant, expiresAt, updatedAt: new Date(), ...people })
    .onConflictDoUpdate({
      target: schema.slackThreads.agentId,
      set: { channel: input.channel, threadTs: input.threadTs ?? null, assistant: input.assistant, expiresAt, updatedAt: new Date(), ...people },
    });
}

export async function activeThread(agentId: string): Promise<SlackThread | null> {
  const [row] = await getDb()
    .select()
    .from(schema.slackThreads)
    .where(and(eq(schema.slackThreads.agentId, agentId), gt(schema.slackThreads.expiresAt, new Date())));
  return row ?? null;
}

export async function agentForThread(channel: string, threadTs: string | undefined) {
  if (!threadTs) return null;
  const [row] = await getDb()
    .select({ agentId: schema.slackThreads.agentId })
    .from(schema.slackThreads)
    .where(and(eq(schema.slackThreads.channel, channel), eq(schema.slackThreads.threadTs, threadTs), gt(schema.slackThreads.expiresAt, new Date())));
  return row?.agentId ?? null;
}

async function agentInfo(agentId: string) {
  const [agent] = await getDb().select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.id, agentId));
  return agent ?? null;
}

export async function postAgentText(input: { channel: string; threadTs?: string; text: string; as?: SlackIdentity }) {
  return postMessage({ channel: input.channel, threadTs: input.threadTs, text: plainFallback(input.text), blocks: markdownBlocks(input.text), as: input.as });
}

type LiveStream = { channel: string; ts: string | null; sent: string; failed: boolean; queue: Promise<void>; startedAt: number };

const streams = new Map<string, LiveStream>();
const STREAM_TTL_MS = 2 * 60 * 1000;

function streamKey(agentId: string, streamId: string) {
  return `${agentId}:${streamId}`;
}

function sweepStreams(now = Date.now()) {
  for (const [key, stream] of streams) if (now - stream.startedAt > STREAM_TTL_MS) streams.delete(key);
}

export function streamDelta(agentId: string, streamId: string, text: string) {
  sweepStreams();
  const key = streamKey(agentId, streamId);
  let stream = streams.get(key);
  if (!stream) {
    stream = { channel: "", ts: null, sent: "", failed: false, queue: Promise.resolve(), startedAt: Date.now() };
    streams.set(key, stream);
    const current = stream;
    current.queue = current.queue.then(async () => {
      const thread = await activeThread(agentId);
      if (!thread?.threadTs) {
        current.failed = true;
        return;
      }
      current.channel = thread.channel;
      const result = (await slackCall("chat.startStream", {
        channel: thread.channel,
        thread_ts: thread.threadTs,
        ...(thread.slackUser ? { recipient_user_id: thread.slackUser } : {}),
        ...(thread.slackTeam ? { recipient_team_id: thread.slackTeam } : {}),
      })) as { ok: boolean; ts?: string; error?: string };
      if (!result.ok || !result.ts) {
        current.failed = true;
        log("slack_stream_unavailable", { agentId, error: result.error });
        return;
      }
      current.ts = result.ts;
    });
  }
  const live = stream;
  live.queue = live.queue.then(async () => {
    if (live.failed || !live.ts || !text.startsWith(live.sent) || text.length === live.sent.length) return;
    const piece = text.slice(live.sent.length);
    const result = await slackCall("chat.appendStream", { channel: live.channel, ts: live.ts, markdown_text: piece });
    if (result.ok) live.sent = text;
    else live.failed = true;
  });
  return live.queue;
}

async function finishStream(agentId: string, streamId: string, text: string) {
  const key = streamKey(agentId, streamId);
  const live = streams.get(key);
  if (!live) return false;
  streams.delete(key);
  await live.queue;
  if (live.failed || !live.ts) return false;
  const rest = text.startsWith(live.sent) ? text.slice(live.sent.length) : "";
  const result = await slackCall("chat.stopStream", { channel: live.channel, ts: live.ts, ...(rest ? { markdown_text: rest } : {}) });
  if (!result.ok) return false;
  if (!text.startsWith(live.sent)) {
    await slackCall("chat.update", { channel: live.channel, ts: live.ts, text: plainFallback(text), blocks: markdownBlocks(text) });
  }
  return true;
}

export async function relayAgentChat(agentId: string, text: string, streamId?: string) {
  if (streamId && (await finishStream(agentId, streamId, text))) return true;
  const thread = await activeThread(agentId);
  if (!thread) return false;
  const agent = await agentInfo(agentId);
  if (!agent) return false;
  const result = await postAgentText({ channel: thread.channel, threadTs: thread.threadTs ?? undefined, text, as: agentIdentity(agent) });
  return result.ok;
}

export async function setThreadStatus(agentId: string, status: string) {
  const thread = await activeThread(agentId);
  if (!thread?.assistant || !thread.threadTs) return;
  await slackCall("assistant.threads.setStatus", { channel_id: thread.channel, thread_ts: thread.threadTs, status });
}

export async function relayActivity(agentId: string, text: string) {
  await setThreadStatus(agentId, statusFromActivity(text));
}

export async function setThreadTitle(channel: string, threadTs: string, text: string) {
  const title = text.replace(/\s+/g, " ").trim().slice(0, 60);
  if (title) await slackCall("assistant.threads.setTitle", { channel_id: channel, thread_ts: threadTs, title });
}

export async function startAssistantThread(input: { channel: string; threadTs: string; agentNames: string[] }) {
  const prompts = input.agentNames.slice(0, 4).map((name) => ({ title: copy.slackApp.promptTitle(name), message: copy.slackApp.promptMessage(name) }));
  if (prompts.length) {
    await slackCall("assistant.threads.setSuggestedPrompts", { channel_id: input.channel, thread_ts: input.threadTs, title: copy.slackApp.promptsHeading, prompts });
  }
  const text = input.agentNames.length ? copy.slackApp.assistantHello(input.agentNames) : copy.slackApp.noAgentsShort;
  await postAgentText({ channel: input.channel, threadTs: input.threadTs, text });
}

export async function postApprovalInThread(agentId: string, blocks: unknown[], fallback: string) {
  const thread = await activeThread(agentId);
  if (!thread) return false;
  const agent = await agentInfo(agentId);
  if (!agent) return false;
  await setThreadStatus(agentId, copy.slackApp.statusWaiting);
  const result = await postMessage({ channel: thread.channel, threadTs: thread.threadTs ?? undefined, text: fallback, blocks, as: agentIdentity(agent) });
  return result.ok;
}

export function progressBlocks(title: string, steps: string[], state: "running" | "ok" | "failed", summary?: string) {
  const label = state === "running" ? copy.slackApp.progressRunning : state === "ok" ? copy.slackApp.progressDone : copy.slackApp.progressFailed;
  const list = steps
    .slice(0, 20)
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");
  return [
    { type: "markdown", text: `**${title}** · ${label}` },
    ...(list ? [{ type: "markdown", text: list.slice(0, 2900) }] : []),
    ...(summary ? [{ type: "context", elements: [{ type: "mrkdwn", text: escapeSlack(summary).slice(0, 2900) }] }] : []),
  ];
}

export async function startRunProgress(agentId: string, runId: string, title: string, steps: string[]) {
  const thread = await activeThread(agentId);
  if (!thread) return;
  const agent = await agentInfo(agentId);
  if (!agent) return;
  const result = (await postMessage({
    channel: thread.channel,
    threadTs: thread.threadTs ?? undefined,
    text: `${title}: ${copy.slackApp.progressRunning}`,
    blocks: progressBlocks(title, steps, "running"),
    as: agentIdentity(agent),
  })) as { ok: boolean; ts?: string };
  if (result.ok && result.ts) {
    await getDb().update(schema.slackThreads).set({ progressTs: result.ts, progressRunId: runId }).where(eq(schema.slackThreads.agentId, agentId));
  }
}

export async function finishRunProgress(agentId: string, runId: string, title: string, steps: string[], ok: boolean, summary: string) {
  const thread = await activeThread(agentId);
  if (!thread?.progressTs || thread.progressRunId !== runId) return;
  const result = await slackCall("chat.update", {
    channel: thread.channel,
    ts: thread.progressTs,
    text: `${title}: ${ok ? copy.slackApp.progressDone : copy.slackApp.progressFailed}`,
    blocks: progressBlocks(title, steps, ok ? "ok" : "failed", summary),
  });
  if (!result.ok) log("slack_progress_update_failed", { agentId, runId, error: result.error });
  await getDb().update(schema.slackThreads).set({ progressTs: null, progressRunId: null }).where(eq(schema.slackThreads.agentId, agentId));
}

export async function mirrorPanelMessage(agentId: string, author: string, text: string) {
  const thread = await activeThread(agentId);
  if (!thread) return;
  await postAgentText({ channel: thread.channel, threadTs: thread.threadTs ?? undefined, text: copy.slackApp.fromPanel(author, text) });
}
