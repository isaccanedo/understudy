import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";
if (url) process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.UNDERSTUDY_ALLOW_PRIVATE_MCP = "1";

const ids = {
  owner: "usr_gk_owner",
  member: "usr_gk_member",
  stranger: "usr_gk_stranger",
  admin: "usr_gk_admin",
  agent: "agt_gk",
  server: "mcp_gk",
  recipe: "rcp_gk",
};
const token = "ust_gatekeeper_test_token";
const calls: { to: string; body: string }[] = [];
let upstream: Server;
let panel: Server;
let panelUrl = "";

function listen(server: Server) {
  return new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

async function rpc(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${panelUrl}/api/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)))
    .find((m) => m.id === 1);
  return line?.result?.content?.[0]?.text as string;
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
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const server = new McpServer({ name: "mail", version: "1" });
    server.registerTool("send", { description: "send mail", inputSchema: { to: z.string(), body: z.string() } }, async (args) => {
      calls.push(args);
      return { content: [{ type: "text", text: `sent to ${args.to}` }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  const upstreamUrl = await listen(upstream);
  const { getDb, schema } = await import("@/lib/db");
  const { hashToken } = await import("@/lib/ids");
  const db = getDb();
  await (await import("./test-db")).migrateTestDb();
  await db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, ids.server));
  await db.delete(schema.user).where(inArray(schema.user.id, [ids.owner, ids.member, ids.stranger, ids.admin]));
  await db.insert(schema.user).values([
    { id: ids.owner, name: "Owner", email: "gk-owner@test.local", status: "approved" },
    { id: ids.member, name: "Member", email: "gk-member@test.local", status: "approved" },
    { id: ids.stranger, name: "Stranger", email: "gk-stranger@test.local", status: "approved" },
    { id: ids.admin, name: "Admin", email: "gk-admin@test.local", status: "approved", admin: true },
  ]);
  await db.insert(schema.mcpServers).values({ id: ids.server, name: "Mail", slug: "mail", url: `${upstreamUrl}/mcp`, askAll: true });
  await db.insert(schema.agents).values({
    id: ids.agent,
    ownerId: ids.owner,
    name: "GK",
    look: { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" },
    tokenHash: hashToken(token),
    tools: { notifyOwner: true, slack: false, slackChannels: [], servers: [ids.server], askTools: [] },
  } as never);
  await db.insert(schema.agentMembers).values({ agentId: ids.agent, userId: ids.member, role: "viewer" });
  await db.insert(schema.recipes).values({
    id: ids.recipe,
    agentId: ids.agent,
    recipe: { title: "t", trigger: "x", steps: [], questions: [], askFirstRuns: 0 },
    active: true,
    webhookSecretHash: hashToken("hook-secret"),
  });

  const { createHub } = await import("./hub");
  const { handleGatekeeper } = await import("./gatekeeper");
  const { handleWebhook } = await import("./webhook");
  const hub = createHub();
  panel = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/api/mcp") return void handleGatekeeper(hub, req, res);
    if (path.startsWith("/api/hooks/")) return void handleWebhook(hub, req, res, path);
    res.writeHead(404);
    res.end();
  });
  panelUrl = await listen(panel);
});

after(async () => {
  if (!url) return;
  const { getDb, schema, getPool } = await import("@/lib/db");
  await getDb().delete(schema.mcpServers).where(eq(schema.mcpServers.id, ids.server));
  await getDb().delete(schema.user).where(inArray(schema.user.id, [ids.owner, ids.member, ids.stranger, ids.admin]));
  upstream.close();
  panel.close();
  await getPool().end();
  setTimeout(() => process.exit(0), 100).unref();
});

test("an approval-gated tool is not called when the owner denies", { skip }, async () => {
  const { createHub } = await import("./hub");
  const pending = rpc("mail__send", { to: "client@example.com", body: "hello" });
  const approval = await pendingApproval();
  assert.equal(approval.fields.find((f) => f.label === "to")?.value, "client@example.com");
  await createHub().answerApproval(approval.id, false, "no", ids.owner);
  const result = await pending;
  assert.match(result, /^not called/);
  assert.equal(calls.length, 0);
});

test("an approved tool runs with exactly the approved arguments", { skip }, async () => {
  const { createHub } = await import("./hub");
  const body = "x".repeat(5000);
  const pending = rpc("mail__send", { to: "client@example.com", body });
  const approval = await pendingApproval();
  assert.equal(approval.fields.find((f) => f.label === "body")?.value, body);
  assert.ok(approval.payloadHash);
  await createHub().answerApproval(approval.id, true, undefined, ids.owner);
  assert.equal(await pending, "sent to client@example.com");
  assert.deepEqual(calls.at(-1), { to: "client@example.com", body });
});

test("a call too big to show is refused instead of truncated", { skip }, async () => {
  const before = calls.length;
  const result = await rpc("mail__send", { to: "a@example.com", body: "y".repeat(30000) });
  assert.match(result, /^not called/);
  assert.equal(calls.length, before);
});

test("an owner rule stops a tool call before anyone is asked, and the owner is told", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  await db.update(schema.agents).set({ rules: [{ id: "rule_gk_mail", kind: "allowed_email_domains", domains: ["example.com"] }] }).where(eq(schema.agents.id, ids.agent));
  const before = calls.length;
  const approvalsBefore = (await db.select().from(schema.approvals).where(eq(schema.approvals.agentId, ids.agent))).length;
  try {
    const result = await rpc("mail__send", { to: "someone@outside.net", body: "hello" });
    assert.match(result, /^not called: blocked by your owner's rule "Never send to email addresses outside example.com\."/);
    assert.equal(calls.length, before);
    assert.equal((await db.select().from(schema.approvals).where(eq(schema.approvals.agentId, ids.agent))).length, approvalsBefore);
    const notes = await db.select().from(schema.messages).where(eq(schema.messages.agentId, ids.agent));
    assert.ok(notes.some((note) => note.role === "system" && note.text.includes("someone@outside.net")));
  } finally {
    await db.update(schema.agents).set({ rules: [] }).where(eq(schema.agents.id, ids.agent));
  }
});

test("the gatekeeper refuses a wrong token", { skip }, async () => {
  const res = await fetch(`${panelUrl}/api/mcp`, {
    method: "POST",
    headers: { Authorization: "Bearer ust_wrong", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 401);
});

test("webhooks need the exact secret and an active task", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  assert.equal((await fetch(`${panelUrl}/api/hooks/${ids.recipe}/wrong`, { method: "POST", body: "{}" })).status, 404);
  assert.equal((await fetch(`${panelUrl}/api/hooks/${ids.recipe}/hook-secret`, { method: "GET" })).status, 405);
  assert.equal((await fetch(`${panelUrl}/api/hooks/${ids.recipe}/hook-secret`, { method: "POST", body: "{}" })).status, 202);
  const queued = await getDb().select().from(schema.inboundQueue).where(eq(schema.inboundQueue.agentId, ids.agent));
  assert.ok(queued.some((row) => (row.message as { type?: string }).type === "run_recipe" && row.runId));
  await getDb().update(schema.recipes).set({ active: false }).where(eq(schema.recipes.id, ids.recipe));
  assert.equal((await fetch(`${panelUrl}/api/hooks/${ids.recipe}/hook-secret`, { method: "POST", body: "{}" })).status, 409);
  const [stored] = await getDb().select().from(schema.recipes).where(eq(schema.recipes.id, ids.recipe));
  assert.equal(stored.webhookSecret, null);
  assert.notEqual(stored.webhookSecretHash, "hook-secret");
});

test("one address hammering wrong secrets is throttled before any lookup", { skip }, async () => {
  const statuses = new Set<number>();
  for (let i = 0; i < 30; i++) {
    statuses.add((await fetch(`${panelUrl}/api/hooks/rcp_nope_${i}/wrong`, { method: "POST", body: "{}", headers: { "X-Forwarded-For": "203.0.113.9" } })).status);
  }
  assert.ok(statuses.has(429));
});

test("access: owner, member role and strangers", { skip }, async () => {
  const { agentAccess, accessibleAgentIds, canApprove } = await import("@/lib/access");
  assert.equal(await agentAccess(ids.owner, ids.agent), "owner");
  assert.equal(await agentAccess(ids.member, ids.agent), "viewer");
  assert.equal(await agentAccess(ids.stranger, ids.agent), null);
  assert.equal(canApprove(await agentAccess(ids.member, ids.agent)), false);
  assert.ok((await accessibleAgentIds(ids.member)).includes(ids.agent));
  assert.ok(!(await accessibleAgentIds(ids.member, ["owner", "approver"])).includes(ids.agent));
});

test("access: an admin reads every agent but answers none", { skip }, async () => {
  const { agentAccess, accessibleAgentIds, canApprove } = await import("@/lib/access");
  assert.equal(await agentAccess(ids.admin, ids.agent), "viewer");
  assert.equal(canApprove(await agentAccess(ids.admin, ids.agent)), false);
  assert.ok((await accessibleAgentIds(ids.admin)).includes(ids.agent));
  assert.ok(!(await accessibleAgentIds(ids.admin, ["owner", "approver"])).includes(ids.agent));
});

test("stopping the agent closes its pending approval, the gated tool is not called and a late answer does not approve it", { skip }, async () => {
  const { createHub } = await import("./hub");
  const { viewerHandlers } = await import("./hub/viewer-handlers");
  const { getDb, schema } = await import("@/lib/db");
  const hub = createHub();
  const before = calls.length;
  const pending = rpc("mail__send", { to: "client@example.com", body: "stop me" });
  const approval = await pendingApproval();
  await viewerHandlers.stop({ hub, agentId: ids.agent, userId: ids.owner, offline: () => {}, refuse: () => {} }, { type: "stop" });
  const result = await pending;
  assert.match(result, /^not called: the owner stopped/);
  assert.equal(calls.length, before);
  assert.equal(await hub.answerApproval(approval.id, true, undefined, ids.owner), false);
  const [row] = await getDb().select().from(schema.approvals).where(eq(schema.approvals.id, approval.id));
  assert.equal(row.status, "cancelled");
  assert.equal(row.answeredBy, ids.owner);
  assert.equal(await hub.approvalStatus(approval.id), "cancelled");
});

test("request_approval tells the brain the step was stopped when the owner stops it", { skip }, async () => {
  const { createHub } = await import("./hub");
  const pending = rpc("request_approval", { summary: "Join a channel" });
  await pendingApproval();
  await createHub().cancelApprovals(ids.agent, ids.owner);
  const result = await pending;
  assert.match(result, /^stopped: /);
  const later = await rpc("wait_for_approval", { requestId: result.match(/requestId: (\S+)\]/)![1] });
  assert.match(later, /^stopped: /);
});

test("an approved action in a running task run lets exactly that call through once, and nothing else", { skip }, async () => {
  const { createHub } = await import("./hub");
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  const hub = createHub();
  const runId = "run_gk_action";
  await db.delete(schema.runs).where(eq(schema.runs.id, runId));
  await db.insert(schema.runs).values({ id: runId, agentId: ids.agent, trigger: "manual", status: "running" });
  const action = { to: "client@example.com", body: "the summary" };
  const countApprovals = async () => (await db.select().from(schema.approvals).where(eq(schema.approvals.agentId, ids.agent))).length;

  const asked = rpc("request_approval", { summary: "Send the summary", runId, stepId: "s3", action: { tool: "mcp__gatekeeper__mail__send", args: action } });
  const step = await pendingApproval();
  assert.equal(step.runId, runId);
  assert.deepEqual(step.fields, [
    { label: "Action", value: "mail__send" },
    { label: "to", value: "client@example.com" },
    { label: "body", value: "the summary" },
  ]);
  await hub.answerApproval(step.id, true, undefined, ids.owner);
  assert.match(await asked, /^approved/);

  const before = calls.length;
  const approvals = await countApprovals();
  assert.equal(await rpc("mail__send", action), "sent to client@example.com");
  assert.equal(calls.length, before + 1);
  assert.equal(await countApprovals(), approvals);
  const [used] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, step.id));
  assert.ok(used.usedAt);

  const again = rpc("mail__send", action);
  const second = await pendingApproval();
  await hub.answerApproval(second.id, false, undefined, ids.owner);
  assert.match(await again, /^not called/);
  assert.equal(calls.length, before + 1);
  await db.delete(schema.runs).where(eq(schema.runs.id, runId));
});

test("an approved action does not cover other arguments, a finished run, a stale answer or a chat without a run", { skip }, async () => {
  const { createHub } = await import("./hub");
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  const hub = createHub();
  const runId = "run_gk_action_limits";
  await db.delete(schema.runs).where(eq(schema.runs.id, runId));
  await db.insert(schema.runs).values({ id: runId, agentId: ids.agent, trigger: "manual", status: "running" });
  const approve = async (args: Record<string, unknown>, run?: string) => {
    const asked = rpc("request_approval", { summary: "Send", ...(run ? { runId: run } : {}), action: { tool: "mail__send", args } });
    const approval = await pendingApproval();
    await hub.answerApproval(approval.id, true, undefined, ids.owner);
    assert.match(await asked, /^approved/);
    return approval.id;
  };
  const stillAsks = async (args: Record<string, unknown>) => {
    const before = calls.length;
    const pending = rpc("mail__send", args);
    const approval = await pendingApproval();
    await hub.answerApproval(approval.id, false, undefined, ids.owner);
    assert.match(await pending, /^not called/);
    assert.equal(calls.length, before);
  };

  await approve({ to: "client@example.com", body: "approved text" }, runId);
  await stillAsks({ to: "client@example.com", body: "different text" });
  await stillAsks({ to: "other@example.com", body: "approved text" });

  await approve({ to: "client@example.com", body: "no run" });
  await stillAsks({ to: "client@example.com", body: "no run" });

  const stale = await approve({ to: "client@example.com", body: "stale" }, runId);
  await db.update(schema.approvals).set({ answeredAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(schema.approvals.id, stale));
  await stillAsks({ to: "client@example.com", body: "stale" });

  await approve({ to: "client@example.com", body: "after the run" }, runId);
  await db.update(schema.runs).set({ status: "ok", finishedAt: new Date() }).where(eq(schema.runs.id, runId));
  await stillAsks({ to: "client@example.com", body: "after the run" });

  assert.match(await rpc("request_approval", { summary: "x", runId, action: { tool: "nope__send", args: {} } }), /^not asked: nope__send is not one of your gatekeeper tools/);
  assert.match(await rpc("request_approval", { summary: "x", runId, action: { tool: "request_approval", args: {} } }), /^not asked/);
  await db.delete(schema.runs).where(eq(schema.runs.id, runId));
});
