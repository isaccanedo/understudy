import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";

if (url) process.env.DATABASE_URL = url;

const ids = { owner: "usr_test_owner", other: "usr_test_other", agentA: "agt_test_a", agentB: "agt_test_b", run: "run_test_a" };

async function setup() {
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  await (await import("./test-db")).migrateTestDb();
  await cleanup();
  await db.insert(schema.user).values([
    { id: ids.owner, name: "Owner", email: "owner@test.local", status: "approved" },
    { id: ids.other, name: "Other", email: "other@test.local", status: "approved" },
  ]);
  const tools = { notifyOwner: true, slack: false, slackChannels: [] };
  const look = { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" };
  await db.insert(schema.agents).values([
    { id: ids.agentA, ownerId: ids.owner, name: "A", look, tokenHash: "hash_a", tools } as never,
    { id: ids.agentB, ownerId: ids.other, name: "B", look, tokenHash: "hash_b", tools } as never,
  ]);
  return { db, schema };
}

async function cleanup() {
  const { getDb, schema } = await import("@/lib/db");
  await getDb().delete(schema.user).where(inArray(schema.user.id, [ids.owner, ids.other]));
}

before(async () => {
  if (url) await setup();
});

after(async () => {
  if (!url) return;
  await cleanup();
  const { getPool } = await import("@/lib/db");
  await getPool().end();
});

test("finishing a run only expires that agent's approvals", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { Hub } = await import("./hub");
  const db = getDb();
  const hub = new Hub();
  await db.insert(schema.runs).values({ id: ids.run, agentId: ids.agentA, trigger: "manual" });
  const mine = await hub.createApproval(ids.agentA, { summary: "mine", runId: ids.run }, "mcp", 3600);
  const noRun = await hub.createApproval(ids.agentB, { summary: "other, no run", runId: "" }, "mcp", 3600);
  const otherSameRunId = await hub.createApproval(ids.agentB, { summary: "other, same run id", runId: ids.run }, "mcp", 3600);
  const finish = (hub as unknown as { finishRun: (a: string, r: string, ok: boolean, s: string) => Promise<void> }).finishRun.bind(hub);
  await finish(ids.agentB, "", true, "attack");
  await finish(ids.agentA, ids.run, true, "done");
  const rows = await db.select().from(schema.approvals).where(inArray(schema.approvals.id, [mine, noRun, otherSameRunId]));
  const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  assert.equal(status[mine], "expired");
  assert.equal(status[noRun], "pending");
  assert.equal(status[otherSameRunId], "pending");
  assert.equal(rows.find((r) => r.id === noRun)?.runId, null);
});

test("an inactive owner's agents cannot authenticate or start runs", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { Hub } = await import("./hub");
  const { authenticateComputer } = await import("./gatekeeper");
  const { hashToken } = await import("@/lib/ids");
  const db = getDb();
  await db.update(schema.agents).set({ tokenHash: hashToken("tok_a") }).where(eq(schema.agents.id, ids.agentA));
  const recipe = { title: "t", trigger: "x", steps: [], questions: [], askFirstRuns: 0 };
  await db.insert(schema.recipes).values({ id: "rcp_test_a", agentId: ids.agentA, recipe, active: true });
  assert.ok(await authenticateComputer("Bearer tok_a"));
  await db.update(schema.user).set({ status: "rejected" }).where(eq(schema.user.id, ids.owner));
  assert.equal(await authenticateComputer("Bearer tok_a"), null);
  const result = await new Hub().startRun("rcp_test_a", "manual");
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.reason, "owner_inactive");
});

test("a computer that connects gets its agent's model", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { Hub } = await import("./hub");
  const { handleComputerMessage } = await import("./hub/computer-handlers");
  await getDb().update(schema.agents).set({ model: "haiku" }).where(eq(schema.agents.id, ids.agentA));
  const hub = new Hub();
  const sent: unknown[] = [];
  hub.sendToComputer = ((_: string, message: unknown) => {
    sent.push(message);
    return true;
  }) as typeof hub.sendToComputer;
  await handleComputerMessage(hub, ids.agentA, { type: "hello", agentId: ids.agentA, version: "1", brains: [{ brain: "claude", loggedIn: true }] } as never);
  assert.ok(sent.some((m) => JSON.stringify(m) === JSON.stringify({ type: "set_model", model: "haiku" })));
  sent.length = 0;
  await handleComputerMessage(hub, ids.agentA, { type: "hello", agentId: ids.agentA, version: "1", brains: [{ brain: "claude", loggedIn: true }], model: "haiku" } as never);
  assert.ok(!sent.some((m) => (m as { type: string }).type === "set_model"));
  await getDb().update(schema.agents).set({ model: null }).where(eq(schema.agents.id, ids.agentA));
  sent.length = 0;
  await handleComputerMessage(hub, ids.agentA, { type: "hello", agentId: ids.agentA, version: "1", brains: [{ brain: "claude", loggedIn: true }], model: "haiku" } as never);
  assert.ok(sent.some((m) => JSON.stringify(m) === JSON.stringify({ type: "set_model", model: "" })));
});

test("a computer that connects gets its owner's rules, and a block it reports reaches the owner's chat", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { Hub } = await import("./hub");
  const { handleComputerMessage } = await import("./hub/computer-handlers");
  const rules = [{ id: "rule_hub_site", kind: "blocked_site", site: "gamble.example" }];
  await getDb().update(schema.agents).set({ rules: rules as never }).where(eq(schema.agents.id, ids.agentA));
  const hub = new Hub();
  const sent: unknown[] = [];
  hub.sendToComputer = ((_: string, message: unknown) => {
    sent.push(message);
    return true;
  }) as typeof hub.sendToComputer;
  try {
    await handleComputerMessage(hub, ids.agentA, { type: "hello", agentId: ids.agentA, version: "1", brains: [{ brain: "claude", loggedIn: true }] } as never);
    assert.ok(sent.some((m) => JSON.stringify(m) === JSON.stringify({ type: "set_rules", rules })));
    await handleComputerMessage(hub, ids.agentA, { type: "rule_blocked", ruleId: "rule_hub_site", rule: "Never open gamble.example.", detail: "https://gamble.example/ is on a site your owner blocked", runId: "run_not_this_agents" } as never);
    const notes = await getDb().select().from(schema.messages).where(eq(schema.messages.agentId, ids.agentA));
    const note = notes.find((m) => m.role === "system" && m.text.includes("Never open gamble.example."));
    assert.ok(note);
    assert.equal(note.runId, null);
  } finally {
    await getDb().update(schema.agents).set({ rules: [] }).where(eq(schema.agents.id, ids.agentA));
  }
});

test("terminal output reaches only the owner's screens, and only the owner can type", { skip }, async () => {
  const { Hub } = await import("./hub");
  const { handleComputerMessage } = await import("./hub/computer-handlers");
  const { EventEmitter } = await import("node:events");
  const hub = new Hub();
  const toComputer: unknown[] = [];
  hub.sendToComputer = ((_: string, message: unknown) => {
    toComputer.push(message);
    return true;
  }) as typeof hub.sendToComputer;
  const socket = () => {
    const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, received: [] as unknown[], send(raw: string) { ws.received.push(JSON.parse(raw)); }, ping() {}, close() {} });
    return ws;
  };
  const ownerWs = socket();
  const viewerWs = socket();
  await hub.attachViewer(ownerWs as never, ids.agentA, ids.owner, "owner");
  await hub.attachViewer(viewerWs as never, ids.agentA, ids.other, "viewer");
  await handleComputerMessage(hub, ids.agentA, { type: "terminal_output", terminalId: "term_abcd", data: "secret" } as never);
  assert.ok(ownerWs.received.some((m) => (m as { type: string }).type === "terminal_output"));
  assert.ok(!viewerWs.received.some((m) => (m as { type: string }).type === "terminal_output"));
  viewerWs.emit("message", Buffer.from(JSON.stringify({ type: "terminal_input", terminalId: "term_abcd", data: "rm -rf /\r" })));
  ownerWs.emit("message", Buffer.from(JSON.stringify({ type: "terminal_input", terminalId: "term_abcd", data: "ls\r" })));
  await new Promise((r) => setTimeout(r, 50));
  const inputs = toComputer.filter((m) => (m as { type: string }).type === "terminal_input");
  assert.deepEqual(inputs, [{ type: "terminal_input", terminalId: "term_abcd", data: "ls\r" }]);
});

test("form values in a computer's approval request reach the approval unchanged", { skip }, async () => {
  const { Hub } = await import("./hub");
  const { handleComputerMessage } = await import("./hub/computer-handlers");
  const hub = new Hub();
  await handleComputerMessage(hub, ids.agentA, {
    type: "approval_request",
    request: {
      id: "req_fields_1",
      runId: "",
      summary: 'Submit "Approve payment" on bank.example',
      fields: [
        { label: "Supplier", value: "Acme Paper Co." },
        { label: "Amount (USD)", value: "1,250.00" },
        { label: "PIN", value: "••••••" },
        { label: "Due date", value: "" },
      ],
    },
  } as never);
  const pending = await hub.pendingApprovalsFor([ids.agentA]);
  const approval = pending.find((a) => a.summary.startsWith('Submit "Approve payment"'));
  assert.deepEqual(approval?.fields, [
    { label: "Supplier", value: "Acme Paper Co." },
    { label: "Amount (USD)", value: "1,250.00" },
    { label: "PIN", value: "••••••" },
    { label: "Due date", value: "" },
  ]);
});

test("jobs reach only the owner, also on a later visit, and only the owner can stop one", { skip }, async () => {
  const { Hub } = await import("./hub");
  const { handleComputerMessage } = await import("./hub/computer-handlers");
  const { EventEmitter } = await import("node:events");
  const hub = new Hub();
  const toComputer: unknown[] = [];
  hub.sendToComputer = ((_: string, message: unknown) => {
    toComputer.push(message);
    return true;
  }) as typeof hub.sendToComputer;
  const socket = () => {
    const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, received: [] as { type: string }[], send(raw: string) { ws.received.push(JSON.parse(raw)); }, ping() {}, close() {} });
    return ws;
  };
  const jobs = [{ id: "job_1", name: "export", command: "python export.py --token=secret", status: "running", startedAt: Date.now() }];
  await handleComputerMessage(hub, ids.agentA, { type: "jobs", jobs } as never);
  const ownerWs = socket();
  const viewerWs = socket();
  await hub.attachViewer(ownerWs as never, ids.agentA, ids.owner, "owner");
  await hub.attachViewer(viewerWs as never, ids.agentA, ids.other, "viewer");
  assert.ok(ownerWs.received.some((m) => m.type === "jobs"));
  assert.ok(!viewerWs.received.some((m) => m.type === "jobs"));
  viewerWs.emit("message", Buffer.from(JSON.stringify({ type: "job_stop", jobId: "job_1" })));
  ownerWs.emit("message", Buffer.from(JSON.stringify({ type: "job_stop", jobId: "job_1" })));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(toComputer.filter((m) => (m as { type: string }).type === "job_stop"), [{ type: "job_stop", jobId: "job_1" }]);
});
