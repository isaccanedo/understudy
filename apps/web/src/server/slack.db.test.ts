import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";
if (url) process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.UNDERSTUDY_PUBLIC_URL = "https://panel.example.com";
delete process.env.SLACK_BOT_TOKEN;

const SECRET = "0123456789abcdef0123456789abcdef";
const ids = { owner: "usr_slack_owner", stranger: "usr_slack_stranger", ana: "agt_slack_ana", bruno: "agt_slack_bruno" };
const slackUsers: Record<string, string> = { UOWNER: "slack-owner@test.local", USTRANGER: "slack-stranger@test.local" };
const slackCalls: { method: string; body: Record<string, unknown> }[] = [];
const responses: unknown[] = [];
const sentToComputer: { agentId: string; message: unknown }[] = [];
const inflight = new Set<Promise<unknown>>();
let panel: Server;
let panelUrl = "";
const realFetch = globalThis.fetch;
let slackPostTs = "1.1";
let streamsWork = true;

async function signed(path: string, body: string, contentType: string, secret = SECRET) {
  const { slackSignature } = await import("./slack-app");
  const ts = String(Math.floor(Date.now() / 1000));
  return realFetch(`${panelUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": contentType, "X-Slack-Request-Timestamp": ts, "X-Slack-Signature": slackSignature(secret, ts, body) },
    body,
  });
}

async function settle() {
  while (inflight.size) await Promise.allSettled([...inflight]);
}

async function waitFor<T>(check: () => T | undefined | false, what: string, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await settle();
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const deliveredText = (text: string) => sentToComputer.filter((d) => (d.message as { text?: string }).text === text);

before(async () => {
  if (!url) return;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (target.startsWith("https://slack.com/api/")) {
      const parsed = new URL(target);
      const method = parsed.pathname.split("/").pop() as string;
      const body = init?.body ? JSON.parse(String(init.body)) : Object.fromEntries(parsed.searchParams);
      slackCalls.push({ method, body });
      if (method === "users.info") {
        const email = slackUsers[String(body.user)];
        return new Response(JSON.stringify(email ? { ok: true, user: { profile: { email } } } : { ok: false, error: "user_not_found" }));
      }
      if (method === "chat.startStream" && !streamsWork) return new Response(JSON.stringify({ ok: false, error: "method_not_supported" }));
      return new Response(JSON.stringify({ ok: true, ts: slackPostTs }));
    }
    if (target.startsWith("https://hooks.slack.com/")) {
      responses.push(JSON.parse(String(init?.body)));
      return new Response("ok");
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const { getDb, schema } = await import("@/lib/db");
  const { writeSetting } = await import("@/lib/app-settings");
  const { SLACK_SECRET_FIELDS, forgetSlackConfig } = await import("./slack");
  const db = getDb();
  await (await import("./test-db")).migrateTestDb();
  await db.delete(schema.user).where(inArray(schema.user.id, [ids.owner, ids.stranger]));
  await db.insert(schema.user).values([
    { id: ids.owner, name: "Owner", email: "slack-owner@test.local", status: "approved" },
    { id: ids.stranger, name: "Stranger", email: "slack-stranger@test.local", status: "approved" },
  ]);
  const look = { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" };
  const tools = { notifyOwner: true, slack: false, slackChannels: [] };
  await db.insert(schema.agents).values([
    { id: ids.ana, ownerId: ids.owner, name: "Ana", look, tokenHash: "slack_hash_a", tools } as never,
    { id: ids.bruno, ownerId: ids.owner, name: "Bruno", look, tokenHash: "slack_hash_b", tools } as never,
  ]);
  await writeSetting("slack", { botToken: "xoxb-test-token-1234567890", signingSecret: SECRET, teamName: "Test", botUserId: "UBOT" }, SLACK_SECRET_FIELDS);
  forgetSlackConfig();

  const { createHub } = await import("./hub");
  const { handleSlack } = await import("./slack-inbound");
  const hub = createHub();
  hub.sendToComputer = ((agentId: string, message: unknown) => {
    sentToComputer.push({ agentId, message });
    return true;
  }) as typeof hub.sendToComputer;
  panel = createServer((req, res) => {
    const handled = handleSlack(hub, req, res, new URL(req.url ?? "/", "http://x").pathname);
    inflight.add(handled);
    void handled.finally(() => inflight.delete(handled));
  });
  await new Promise<void>((resolve) => panel.listen(0, "127.0.0.1", resolve));
  panelUrl = `http://127.0.0.1:${(panel.address() as AddressInfo).port}`;
});

after(async () => {
  if (!url) return;
  globalThis.fetch = realFetch;
  const { getDb, schema, getPool } = await import("@/lib/db");
  const { deleteSetting } = await import("@/lib/app-settings");
  await deleteSetting("slack");
  await getDb().delete(schema.user).where(inArray(schema.user.id, [ids.owner, ids.stranger]));
  panel.close();
  await getPool().end();
  setTimeout(() => process.exit(0), 100).unref();
});

test("requests without the right signature are refused", { skip }, async () => {
  const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
  assert.equal((await signed("/api/slack/events", body, "application/json", "f".repeat(32))).status, 401);
  const ok = await signed("/api/slack/events", body, "application/json");
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { challenge: "abc" });
});

test("a mention goes to the named agent and the answer comes back in the thread as that agent", { skip }, async () => {
  const event = { type: "app_mention", user: "UOWNER", text: "<@UBOT> Bruno, send the report", channel: "C1", ts: "100.1" };
  await signed("/api/slack/events", JSON.stringify({ type: "event_callback", event_id: "Ev1", event }), "application/json");
  await settle();
  const [delivered] = deliveredText("send the report");
  assert.equal(delivered?.agentId, ids.bruno);
  assert.deepEqual(delivered?.message, { type: "chat", text: "send the report", from: "Owner" });
  const { relayAgentChat } = await import("./slack-threads");
  await relayAgentChat(ids.bruno, "**On it.** I'll check the [report](https://x.example).");
  const post = slackCalls.filter((c) => c.method === "chat.postMessage").at(-1);
  assert.equal(post?.body.channel, "C1");
  assert.equal(post?.body.thread_ts, "100.1");
  assert.equal(post?.body.username, "Bruno");
  assert.equal(post?.body.icon_url, `https://panel.example.com/api/agents/${ids.bruno}/avatar.png`);
  assert.deepEqual((post?.body.blocks as { type: string }[])[0].type, "markdown");
  assert.equal(post?.body.text, "On it. I'll check the report (https://x.example).");
  const { getDb, schema } = await import("@/lib/db");
  const stored = await getDb().select().from(schema.messages).where(eq(schema.messages.agentId, ids.bruno));
  assert.ok(stored.some((m) => m.role === "user" && m.via === "slack" && m.text === "send the report"));
});

test("in an assistant thread, follow-ups go to the same agent, the title is set and the status shows work", { skip }, async () => {
  const first = { type: "message", channel_type: "im", user: "UOWNER", text: "Ana, check the invoices", channel: "D1", ts: "200.2", thread_ts: "200.1" };
  await signed("/api/slack/events", JSON.stringify({ type: "event_callback", event_id: "EvA1", event: first }), "application/json");
  await settle();
  const follow = { type: "message", channel_type: "im", user: "UOWNER", text: "and the receipts too", channel: "D1", ts: "200.3", thread_ts: "200.1" };
  await signed("/api/slack/events", JSON.stringify({ type: "event_callback", event_id: "EvA2", event: follow }), "application/json");
  await settle();
  const delivered = [...deliveredText("check the invoices"), ...deliveredText("and the receipts too")];
  assert.deepEqual(delivered.map((d) => d.agentId), [ids.ana, ids.ana]);
  assert.ok(slackCalls.some((c) => c.method === "assistant.threads.setTitle" && c.body.thread_ts === "200.1"));
  assert.ok(slackCalls.some((c) => c.method === "assistant.threads.setStatus" && c.body.thread_ts === "200.1"));
  const { relayActivity } = await import("./slack-threads");
  await relayActivity(ids.ana, "Opening the bank portal");
  const status = slackCalls.filter((c) => c.method === "assistant.threads.setStatus").at(-1);
  assert.equal(status?.body.status, "is opening the bank portal…");
});

test("a new assistant thread gets suggested prompts for the person's agents", { skip }, async () => {
  const event = { type: "assistant_thread_started", assistant_thread: { user_id: "UOWNER", channel_id: "D2", thread_ts: "300.1" } };
  await signed("/api/slack/events", JSON.stringify({ type: "event_callback", event_id: "EvT1", event }), "application/json");
  await settle();
  const prompts = slackCalls.find((c) => c.method === "assistant.threads.setSuggestedPrompts" && c.body.thread_ts === "300.1");
  assert.ok(prompts);
  assert.equal((prompts?.body.prompts as unknown[]).length, 2);
});

test("an approval for an agent talking in a thread lands in that thread, and run progress updates in place", { skip }, async () => {
  const { createHub } = await import("./hub");
  const { getDb, schema } = await import("@/lib/db");
  const hub = createHub();
  const approvalId = await hub.createApproval(ids.ana, { summary: "Pay supplier 2", runId: "", fields: [{ label: "Amount", value: "10" }] }, "mcp", 3600);
  const card = await waitFor(
    () => slackCalls.find((c) => c.method === "chat.postMessage" && JSON.stringify(c.body.blocks).includes(approvalId)),
    "the approval card in the thread",
  );
  assert.equal(card.body.channel, "D1");
  assert.equal(card.body.thread_ts, "200.1");
  assert.ok(card, "approval card in the thread");
  assert.ok(JSON.stringify(card?.body.blocks).includes('"action_id":"approve"'));
  const { startRunProgress, finishRunProgress } = await import("./slack-threads");
  slackPostTs = "555.5";
  await startRunProgress(ids.ana, "run_slack_p", "Invoices", ["Open", "Check"]);
  await finishRunProgress(ids.ana, "run_slack_p", "Invoices", ["Open", "Check"], true, "All good");
  const update = slackCalls.filter((c) => c.method === "chat.update").at(-1);
  assert.equal(update?.body.ts, "555.5");
  assert.match(JSON.stringify(update?.body.blocks), /done/);
  const [thread] = await getDb().select().from(schema.slackThreads).where(eq(schema.slackThreads.agentId, ids.ana));
  assert.equal(thread.progressTs, null);
});

test("a message typed in the panel goes to the agent's active Slack thread too", { skip }, async () => {
  const { mirrorPanelMessage } = await import("./slack-threads");
  await mirrorPanelMessage(ids.ana, "Owner", "also check March");
  const post = slackCalls.filter((c) => c.method === "chat.postMessage").at(-1);
  assert.equal(post?.body.thread_ts, "200.1");
  assert.match(String(post?.body.text), /Owner.*also check March/);
});

test("a retried event is handled once", { skip }, async () => {
  const event = { type: "app_mention", user: "UOWNER", text: "<@UBOT> Ana hi", channel: "C1", ts: "100.2" };
  for (let i = 0; i < 2; i++) await signed("/api/slack/events", JSON.stringify({ type: "event_callback", event_id: "Ev2", event }), "application/json");
  await settle();
  assert.equal(deliveredText("hi").length, 1);
});

test("someone who doesn't own an agent cannot command it", { skip }, async () => {
  const event = { type: "message", channel_type: "im", user: "USTRANGER", text: "Ana, pay everything", channel: "D9", ts: "100.3" };
  await signed("/api/slack/events", JSON.stringify({ type: "event_callback", event_id: "Ev3", event }), "application/json");
  await settle();
  assert.equal(deliveredText("pay everything").length, 0);
  assert.ok(slackCalls.some((c) => c.method === "chat.postMessage" && c.body.channel === "D9"));
});

test("approval buttons answer only for people who may approve", { skip }, async () => {
  const { createHub } = await import("./hub");
  const { getDb, schema } = await import("@/lib/db");
  const hub = createHub();
  const approvalId = await hub.createApproval(ids.ana, { summary: "Pay supplier", runId: "" }, "mcp", 3600);
  await waitFor(
    () => slackCalls.find((c) => c.method === "chat.postMessage" && JSON.stringify(c.body.blocks).includes(approvalId)),
    "the approval card to be posted",
  );
  const click = (user: string, action: string) =>
    signed(
      "/api/slack/interactivity",
      new URLSearchParams({ payload: JSON.stringify({ type: "block_actions", user: { id: user }, actions: [{ action_id: action, value: approvalId }], response_url: "https://hooks.slack.com/actions/x" }) }).toString(),
      "application/x-www-form-urlencoded",
    );
  await click("USTRANGER", "approve");
  await settle();
  let [row] = await getDb().select().from(schema.approvals).where(eq(schema.approvals.id, approvalId));
  assert.equal(row.status, "pending");
  await click("UOWNER", "deny");
  await settle();
  [row] = await getDb().select().from(schema.approvals).where(eq(schema.approvals.id, approvalId));
  assert.equal(row.status, "denied");
  assert.equal(row.answeredBy, ids.owner);
  assert.match(JSON.stringify(responses.at(-1)), /Denied by Owner/);
});

test("the slash command lists the person's agents", { skip }, async () => {
  const res = await signed("/api/slack/commands", new URLSearchParams({ user_id: "UOWNER", command: "/understudy" }).toString(), "application/x-www-form-urlencoded");
  const body = (await res.json()) as { text: string; response_type: string };
  assert.equal(body.response_type, "ephemeral");
  assert.match(body.text, /Ana/);
  assert.match(body.text, /Bruno/);
});

test("a streamed answer is written live in the thread and finished with the final text, without a second post", { skip }, async () => {
  const { streamDelta, relayAgentChat } = await import("./slack-threads");
  const before = slackCalls.length;
  slackPostTs = "777.1";
  await streamDelta(ids.ana, "st_1", "Checking");
  await streamDelta(ids.ana, "st_1", "Checking the invoices");
  await streamDelta(ids.ana, "st_1", "Checking the invoices");
  await relayAgentChat(ids.ana, "Checking the invoices now.", "st_1");
  const calls = slackCalls.slice(before);
  assert.deepEqual(calls.map((c) => c.method), ["chat.startStream", "chat.appendStream", "chat.appendStream", "chat.stopStream"]);
  assert.equal(calls[0].body.thread_ts, "100.2");
  assert.equal(calls[0].body.recipient_user_id, "UOWNER");
  assert.deepEqual(calls.slice(1, 3).map((c) => c.body.markdown_text), ["Checking", " the invoices"]);
  assert.equal(calls[3].body.markdown_text, " now.");
  assert.ok(!calls.some((c) => c.method === "chat.postMessage"));
});

test("when Slack cannot stream, the final answer is posted once as a normal message", { skip }, async () => {
  const { streamDelta, relayAgentChat } = await import("./slack-threads");
  streamsWork = false;
  try {
    const before = slackCalls.length;
    await streamDelta(ids.ana, "st_2", "Hello");
    await relayAgentChat(ids.ana, "Hello there.", "st_2");
    const calls = slackCalls.slice(before).map((c) => c.method);
    assert.deepEqual(calls, ["chat.startStream", "chat.postMessage"]);
  } finally {
    streamsWork = true;
  }
});

test("an owner whose Slack email differs from the panel email links their Slack account once and is then reached and recognized", { skip }, async () => {
  const { createHub } = await import("./hub");
  const { linkSlackUser, readSlackLinkToken, unlinkSlackUser } = await import("./slack-link");
  const hub = createHub();
  try {
    assert.deepEqual(await hub.notifyOwner(ids.ana, "Before the link"), { slack: false, error: "user_not_found" });

    const mention = { type: "app_mention", user: "ULINKED01", text: "<@UBOT> Ana, hello", channel: "C7", ts: "300.1" };
    await signed("/api/slack/events", JSON.stringify({ type: "event_callback", event_id: "EvLink1", event: mention }), "application/json");
    await settle();
    const publicReply = slackCalls.filter((c) => c.method === "chat.postMessage" && c.body.channel === "C7").at(-1);
    assert.ok(publicReply);
    assert.doesNotMatch(JSON.stringify(publicReply.body), /settings\?slack=/);

    const dm = { type: "message", channel_type: "im", user: "ULINKED01", text: "Ana, hello", channel: "D7", ts: "300.2" };
    await signed("/api/slack/events", JSON.stringify({ type: "event_callback", event_id: "EvLink2", event: dm }), "application/json");
    await settle();
    assert.equal(deliveredText("hello").length, 0);
    const privateReply = slackCalls.filter((c) => c.method === "chat.postMessage" && c.body.channel === "D7").at(-1);
    const link = JSON.stringify(privateReply?.body.blocks).match(/https:\/\/panel\.example\.com\/settings\?slack=([^#)\\"]+)#slack/);
    assert.ok(link, "the private reply carries a link to connect the Slack account");
    assert.equal(readSlackLinkToken(decodeURIComponent(link[1])), "ULINKED01");

    await linkSlackUser(ids.owner, "ULINKED01");
    assert.deepEqual(await hub.notifyOwner(ids.ana, "After the link"), { slack: true });
    const notified = slackCalls.filter((c) => c.method === "chat.postMessage" && c.body.channel === "ULINKED01").at(-1);
    assert.equal(notified?.body.text, "After the link");

    const linkedDm = { ...dm, text: "Ana, check the linked inbox", ts: "300.3" };
    await signed("/api/slack/events", JSON.stringify({ type: "event_callback", event_id: "EvLink3", event: linkedDm }), "application/json");
    await settle();
    const [delivered] = deliveredText("check the linked inbox");
    assert.equal(delivered?.agentId, ids.ana);
  } finally {
    await unlinkSlackUser(ids.owner);
  }
});
