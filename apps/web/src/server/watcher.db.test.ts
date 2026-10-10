import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { describeChange } from "./watcher";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";

if (url) process.env.DATABASE_URL = url;

const ids = { owner: "usr_watch_owner", stranger: "usr_watch_stranger", agent: "agt_watch", other: "agt_watch_other", recipe: "rcp_watch", idle: "rcp_watch_idle" };

before(async () => {
  if (!url) return;
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  await (await import("./test-db")).migrateTestDb();
  await db.delete(schema.user).where(inArray(schema.user.id, [ids.owner, ids.stranger]));
  await db.insert(schema.user).values([
    { id: ids.owner, name: "Owner", email: "watch-owner@test.local", status: "approved" },
    { id: ids.stranger, name: "Stranger", email: "watch-stranger@test.local", status: "approved" },
  ]);
  const tools = { notifyOwner: true, slack: false, slackChannels: [] };
  const look = { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" };
  await db.insert(schema.agents).values([
    { id: ids.agent, ownerId: ids.owner, name: "Watcher", look, tokenHash: "hash_watch", tools } as never,
    { id: ids.other, ownerId: ids.stranger, name: "Other", look, tokenHash: "hash_watch_other", tools } as never,
  ]);
  const recipe = { title: "Pay new invoices", trigger: "x", steps: [], questions: [], askFirstRuns: 0 };
  await db.insert(schema.recipes).values([
    { id: ids.recipe, agentId: ids.agent, recipe, active: true },
    { id: ids.idle, agentId: ids.agent, recipe, active: false },
  ]);
  await db.insert(schema.recipeWatches).values([
    { recipeId: ids.recipe, agentId: ids.agent, url: "https://pay.test/invoices", part: "Open invoices", everyMinutes: 15 },
    { recipeId: ids.idle, agentId: ids.agent, url: "https://pay.test/idle", everyMinutes: 15 },
  ]);
});

after(async () => {
  if (!url) return;
  const { getDb, schema, getPool } = await import("@/lib/db");
  await getDb().delete(schema.user).where(inArray(schema.user.id, [ids.owner, ids.stranger]));
  await getPool().end();
});

test("a change is described as added and removed lines, and long changes are cut", () => {
  const text = describeChange("https://pay.test", "Open invoices\nINV-1 $10\nINV-2 $20", "Open invoices\nINV-2 $20\nINV-3 $30");
  assert.match(text, /^The page https:\/\/pay.test changed\./);
  assert.match(text, /Added:\n\+ INV-3 \$30/);
  assert.match(text, /Removed:\n- INV-1 \$10/);
  assert.match(describeChange("u", "a\nb", "b\na"), /different order/);
  assert.ok(describeChange("u", "", "x".repeat(20000)).endsWith("(cut)"));
});

test("due watches of active tasks are checked on online computers, once at a time", { skip }, async () => {
  const { Hub } = await import("./hub");
  const hub = new Hub();
  const sent: { agentId: string; message: unknown }[] = [];
  hub.isOnline = () => true;
  hub.sendToComputer = ((agentId: string, message: unknown) => (sent.push({ agentId, message }), true)) as typeof hub.sendToComputer;
  const now = new Date();
  await hub.watcher.tick(now);
  assert.deepEqual(sent, [{ agentId: ids.agent, message: { type: "watch_check", watchId: ids.recipe, url: "https://pay.test/invoices", part: "Open invoices" } }]);
  await hub.watcher.tick(new Date(now.getTime() + 60_000));
  assert.equal(sent.length, 1);
  hub.isOnline = () => false;
  await hub.watcher.tick(new Date(now.getTime() + 60 * 60_000));
  assert.equal(sent.length, 1);
});

test("the first check is a baseline, a change starts the task with the diff, and other agents cannot answer", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { Hub } = await import("./hub");
  const hub = new Hub();
  const started: { recipeId: string; trigger: string; input?: string }[] = [];
  hub.startRun = (async (recipeId: string, trigger: string, options: { input?: string } = {}) => {
    started.push({ recipeId, trigger, input: options.input });
    return { ok: true, runId: "run_watch" };
  }) as typeof hub.startRun;
  assert.equal((await hub.watcher.result(ids.other, { watchId: ids.recipe, hash: "h0", text: "forged" })).kind, "unknown");
  assert.equal((await hub.watcher.result(ids.agent, { watchId: ids.recipe, hash: "h1", text: "Open invoices\nINV-1 $10" })).kind, "baseline");
  assert.equal((await hub.watcher.result(ids.agent, { watchId: ids.recipe, hash: "h1", text: "Open invoices\nINV-1 $10" })).kind, "same");
  await getDb().update(schema.recipeWatches).set({ checkedAt: null }).where(eq(schema.recipeWatches.recipeId, ids.recipe));
  assert.equal((await hub.watcher.result(ids.agent, { watchId: ids.recipe, error: "the page answered 500" })).kind, "error");
  const [failed] = await getDb().select().from(schema.recipeWatches).where(eq(schema.recipeWatches.recipeId, ids.recipe));
  assert.equal(failed.lastError, "the page answered 500");
  assert.equal(failed.checkedAt, null);
  assert.equal(started.length, 0);
  assert.equal((await hub.watcher.result(ids.agent, { watchId: ids.recipe, hash: "h2", text: "Open invoices\nINV-1 $10\nINV-2 $20" })).kind, "changed");
  assert.equal(started.length, 1);
  assert.equal(started[0].trigger, "watch");
  assert.match(started[0].input ?? "", /Added:\n\+ INV-2 \$20/);
  const [row] = await getDb().select().from(schema.recipeWatches).where(eq(schema.recipeWatches.recipeId, ids.recipe));
  assert.equal(row.lastHash, "h2");
  assert.equal(row.lastError, null);
  assert.ok(row.changedAt);
});
