import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";
if (url) process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.SLACK_BOT_TOKEN = "xoxb-fake-token-for-tests";

const ids = { owner: "usr_sk_owner", agent: "agt_sk" };
const token = "ust_slack_tools_test_token";
const slackCalls: { method: string; params: Record<string, string> }[] = [];
let slack: Server;
let panel: Server;
let panelUrl = "";

function listen(server: Server) {
  return new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

function answer(method: string, params: Record<string, string>) {
  switch (method) {
    case "conversations.list":
      return { ok: true, channels: [{ id: "C0GENERAL1", name: "general", is_member: true }] };
    case "chat.postMessage":
      return { ok: true, ts: "1700000000.000200", channel: params.channel };
    case "users.lookupByEmail":
      return params.email === "client@outside.net" ? { ok: true, user: { id: "U0OUT00001", profile: { real_name: "Client" } } } : { ok: false, error: "users_not_found" };
    default:
      return { ok: true };
  }
}

async function rpc(method: string, params: Record<string, unknown>) {
  const res = await fetch(`${panelUrl}/api/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)))
    .find((m) => m.id === 1)?.result;
}

const call = async (name: string, args: Record<string, unknown>) => (await rpc("tools/call", { name, arguments: args }))?.content?.[0]?.text as string;
const toolNames = async () => ((await rpc("tools/list", {}))?.tools ?? []).map((t: { name: string }) => t.name) as string[];
const posted = () => slackCalls.filter((c) => c.method === "chat.postMessage" && c.params.username === "Rita");

async function setMode(slackMode: "ask" | "free" | "off", rules: unknown[] = []) {
  const { getDb, schema } = await import("@/lib/db");
  await getDb()
    .update(schema.agents)
    .set({ tools: { notifyOwner: true, slack: false, slackChannels: [], slackMode, servers: [], askTools: [] }, rules: rules as never })
    .where(eq(schema.agents.id, ids.agent));
}

async function pendingApproval() {
  const { getDb, schema } = await import("@/lib/db");
  for (let i = 0; i < 100; i++) {
    const rows = await getDb().select().from(schema.approvals).where(eq(schema.approvals.agentId, ids.agent));
    const pending = rows.find((a) => a.status === "pending");
    if (pending) return pending;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("no pending approval");
}

before(async () => {
  if (!url) return;
  slack = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const target = new URL(req.url ?? "/", "http://x");
    const method = target.pathname.replace(/^\//, "");
    const params = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()).entries());
    for (const [k, v] of target.searchParams) params[k] = v;
    slackCalls.push({ method, params });
    res.writeHead(200, { "Content-Type": "application/json", "x-oauth-scopes": "chat:write" });
    res.end(JSON.stringify(answer(method, params)));
  });
  process.env.SLACK_API_BASE_URL = await listen(slack);
  const { getDb, schema } = await import("@/lib/db");
  const { hashToken } = await import("@/lib/ids");
  const db = getDb();
  await (await import("./test-db")).migrateTestDb();
  await db.delete(schema.user).where(inArray(schema.user.id, [ids.owner]));
  await db.insert(schema.user).values([{ id: ids.owner, name: "Owner", email: "sk-owner@test.local", status: "approved" }]);
  await db.insert(schema.agents).values({
    id: ids.agent,
    ownerId: ids.owner,
    name: "Rita",
    look: { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" },
    tokenHash: hashToken(token),
    tools: { notifyOwner: true, slack: false, slackChannels: [], servers: [], askTools: [] },
  } as never);
  const { createHub } = await import("./hub");
  const { handleGatekeeper } = await import("./gatekeeper");
  const hub = createHub();
  panel = createServer((req, res) => {
    if (new URL(req.url ?? "/", "http://x").pathname === "/api/mcp") return void handleGatekeeper(hub, req, res);
    res.writeHead(404);
    res.end();
  });
  panelUrl = await listen(panel);
});

after(async () => {
  if (!url) return;
  const { getDb, schema, getPool } = await import("@/lib/db");
  await getDb().delete(schema.user).where(inArray(schema.user.id, [ids.owner]));
  slack.close();
  panel.close();
  await getPool().end();
  setTimeout(() => process.exit(0), 100).unref();
});

test("an agent with no Slack setting gets the Slack tools, asking first", { skip }, async () => {
  const names = await toolNames();
  for (const name of ["slack_list_channels", "slack_post_message", "slack_send_dm", "slack_read_messages", "slack_upload_file", "slack_join_channel"]) assert.ok(names.includes(name), name);
  const description = ((await rpc("tools/list", {}))?.tools ?? []).find((t: { name: string }) => t.name === "slack_post_message")?.description ?? "";
  assert.match(description, /approves the exact text/);
});

test("a Slack post waits for the owner, a denial sends nothing, an approval posts as the agent", { skip }, async () => {
  const { createHub } = await import("./hub");
  await setMode("ask");
  const denied = call("slack_post_message", { channel: "#general", text: "first try" });
  const first = await pendingApproval();
  assert.equal(first.summary, "Slack: post in #general");
  assert.equal(first.fields.find((f) => f.label === "Message")?.value, "first try");
  await createHub().answerApproval(first.id, false, "not now", ids.owner);
  assert.match(await denied, /^not done: the owner denied: not now/);
  assert.equal(posted().length, 0);

  const approved = call("slack_post_message", { channel: "#general", text: "second try" });
  const second = await pendingApproval();
  await createHub().answerApproval(second.id, true, undefined, ids.owner);
  assert.match(await approved, /"posted":true/);
  assert.equal(posted().length, 1);
  assert.equal(posted()[0].params.channel, "C0GENERAL1");
  assert.match(posted()[0].params.icon_url, /\/api\/agents\/agt_sk\/avatar\.png$/);
});

test("an owner rule blocks a Slack message before anyone is asked, even when posting without asking", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  await setMode("free", [{ id: "rule_sk_mail", kind: "allowed_email_domains", domains: ["example.com"] }]);
  const before = posted().length;
  const approvals = (await getDb().select().from(schema.approvals).where(eq(schema.approvals.agentId, ids.agent))).length;
  const result = await call("slack_send_dm", { person: "client@outside.net", text: "here is the file" });
  assert.match(result, /blocked by your owner's rule/);
  assert.equal(posted().length, before);
  assert.equal((await getDb().select().from(schema.approvals).where(eq(schema.approvals.agentId, ids.agent))).length, approvals);
});

test("posting without asking goes straight out and is recorded in the audit", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  await setMode("free");
  const result = await call("slack_post_message", { channel: "#general", text: "daily numbers" });
  assert.match(result, /"posted":true/);
  assert.equal(posted().at(-1)?.params.text, "daily numbers");
  const audit = await getDb().select().from(schema.toolCalls).where(eq(schema.toolCalls.agentId, ids.agent));
  assert.ok(audit.some((row) => row.tool === "slack_post_message" && row.ok && (row.args as { text?: string }).text === "daily numbers"));
});

test("Slack off removes the tools", { skip }, async () => {
  await setMode("off");
  assert.ok(!(await toolNames()).some((name) => name.startsWith("slack_")));
  assert.match(await call("slack_post_message", { channel: "#general", text: "x" }), /unknown tool/);
});

test("a task step approved with its exact Slack message sends it to another person without asking twice", { skip }, async () => {
  const { createHub } = await import("./hub");
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  await setMode("ask");
  const runId = "run_sk_action";
  await db.delete(schema.runs).where(eq(schema.runs.id, runId));
  await db.insert(schema.runs).values({ id: runId, agentId: ids.agent, trigger: "manual", status: "running" });
  const message = { person: "client@outside.net", text: "Weekly summary: all done." };
  const asked = call("request_approval", { summary: "Send the summary by Slack DM", runId, action: { tool: "slack_send_dm", args: message } });
  const step = await pendingApproval();
  await createHub().answerApproval(step.id, true, undefined, ids.owner);
  assert.match(await asked, /^approved/);

  const before = posted().length;
  assert.match(await call("slack_send_dm", message), /"sent":true/);
  assert.equal(posted().length, before + 1);
  assert.equal(posted().at(-1)?.params.channel, "U0OUT00001");
  const pending = (await db.select().from(schema.approvals).where(eq(schema.approvals.agentId, ids.agent))).filter((row) => row.status === "pending");
  assert.equal(pending.length, 0);

  const again = call("slack_send_dm", message);
  const second = await pendingApproval();
  assert.equal(second.summary, "Slack: message Client (client@outside.net)");
  await createHub().answerApproval(second.id, false, undefined, ids.owner);
  assert.match(await again, /^not done/);
  assert.equal(posted().length, before + 1);
  await db.delete(schema.runs).where(eq(schema.runs.id, runId));
});
