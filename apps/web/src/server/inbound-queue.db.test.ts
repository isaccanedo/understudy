import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";
if (url) process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET ??= "test-secret";

const ids = { owner: "usr_q_owner", agent: "agt_q", stopped: "agt_q_stopped" };
const look = { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" };
const tools = { notifyOwner: true, slack: false, slackChannels: [] };

function fakeComputer() {
  const ws = Object.assign(new EventEmitter(), {
    OPEN: 1,
    readyState: 1,
    received: [] as { type: string; text?: string }[],
    send(raw: string) {
      ws.received.push(JSON.parse(raw));
    },
    ping() {},
    close() {
      ws.readyState = 3;
      ws.emit("close");
    },
  });
  return ws;
}

before(async () => {
  if (!url) return;
  await (await import("./test-db")).migrateTestDb();
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  await db.delete(schema.user).where(eq(schema.user.id, ids.owner));
  await db.insert(schema.user).values({ id: ids.owner, name: "Owner", email: "q-owner@test.local", status: "approved" });
  await db.insert(schema.agents).values([
    { id: ids.agent, ownerId: ids.owner, name: "Q", look, tokenHash: "q_hash", tools, computerStatus: "running", lastSeenAt: new Date() } as never,
    { id: ids.stopped, ownerId: ids.owner, name: "S", look, tokenHash: "q_hash_s", tools, computerStatus: "stopped_by_owner" } as never,
  ]);
});

after(async () => {
  if (!url) return;
  const { getDb, schema, getPool } = await import("@/lib/db");
  await getDb().delete(schema.user).where(inArray(schema.user.id, [ids.owner]));
  await getPool().end();
  setTimeout(() => process.exit(0), 100).unref();
});

test("a message sent while the computer is reconnecting waits and arrives on hello, in order", { skip }, async () => {
  const { Hub } = await import("./hub");
  const hub = new Hub();
  const first = await hub.deliver(ids.agent, { type: "chat", text: "one", from: "Owner" }, { source: "panel" });
  await hub.deliver(ids.agent, { type: "chat", text: "two", from: "Owner" }, { source: "slack", slack: { channel: "C1", threadTs: "1.1" } });
  assert.deepEqual(first, { status: "queued", starting: false });
  const ws = fakeComputer();
  await hub.attachComputer(ws as never, ids.agent);
  ws.emit("message", Buffer.from(JSON.stringify({ type: "hello", agentId: ids.agent, version: "1", brains: [{ brain: "claude", loggedIn: true }] })));
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(ws.received.filter((m) => m.type === "chat").map((m) => m.text), ["one", "two"]);
  const { getDb, schema } = await import("@/lib/db");
  assert.equal((await getDb().select().from(schema.inboundQueue).where(eq(schema.inboundQueue.agentId, ids.agent))).length, 0);
  ws.close();
});

test("a queued message is delivered once even if two panels race for it", { skip }, async () => {
  const { Hub } = await import("./hub");
  const a = new Hub();
  const b = new Hub();
  await a.deliver(ids.agent, { type: "chat", text: "only once", from: "Owner" }, { source: "panel" });
  const wa = fakeComputer();
  const wb = fakeComputer();
  await a.attachComputer(wa as never, ids.agent);
  await b.attachComputer(wb as never, ids.agent);
  await Promise.all([a.inbound.flush(ids.agent), b.inbound.flush(ids.agent)]);
  const count = [...wa.received, ...wb.received].filter((m) => m.type === "chat" && m.text === "only once").length;
  assert.equal(count, 1);
  wa.close();
  wb.close();
});

test("during a rollout, a message that lands on the panel without the computer reaches it through the other panel", { skip }, async () => {
  const { Hub } = await import("./hub");
  const oldPanel = new Hub();
  const newPanel = new Hub();
  const ws = fakeComputer();
  await oldPanel.attachComputer(ws as never, ids.agent);
  const result = await newPanel.deliver(ids.agent, { type: "chat", text: "from slack", from: "Owner" }, { source: "slack", slack: { channel: "C9", threadTs: "9.9" } });
  assert.equal(result.status, "queued");
  await oldPanel.inbound.tick([ids.agent]);
  assert.deepEqual(ws.received.filter((m) => m.type === "chat").map((m) => m.text), ["from slack"]);
  ws.close();
});

test("a stopped computer is started and the sender is told so", { skip }, async () => {
  const { Hub } = await import("./hub");
  const hub = new Hub();
  let ensured = "";
  hub.ensureComputer = (async (agentId: string) => {
    ensured = agentId;
    return true;
  }) as typeof hub.ensureComputer;
  const result = await hub.deliver(ids.stopped, { type: "chat", text: "wake up", from: "Owner" }, { source: "panel" });
  assert.deepEqual(result, { status: "queued", starting: true });
  assert.equal(ensured, ids.stopped);
});

test("messages that wait more than 30 minutes are dropped with a note, and their runs fail", { skip }, async () => {
  const { Hub } = await import("./hub");
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  const hub = new Hub();
  await db.insert(schema.runs).values({ id: "run_q_old", agentId: ids.stopped, trigger: "manual", status: "running" });
  await db.insert(schema.inboundQueue).values({
    id: "inq_old",
    agentId: ids.stopped,
    message: { type: "run_recipe" },
    source: "run",
    runId: "run_q_old",
    createdAt: new Date(Date.now() - 31 * 60 * 1000),
    expiresAt: new Date(Date.now() - 60 * 1000),
  });
  await hub.inbound.expire();
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, "run_q_old"));
  assert.equal(run.status, "failed");
  assert.equal((await db.select().from(schema.inboundQueue).where(eq(schema.inboundQueue.id, "inq_old"))).length, 0);
});
