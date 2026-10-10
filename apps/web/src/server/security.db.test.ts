import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";
if (url) process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";
process.env.UNDERSTUDY_PUBLIC_URL = "http://localhost:3999";
process.env.UNDERSTUDY_ALLOWED_EMAIL_DOMAIN = "sec.test";
process.env.UNDERSTUDY_ADMIN_EMAILS = "boss@sec.test,cli-boss@sec.test";

const ids = { owner: "usr_sec_owner", agentA: "agt_sec_a", agentB: "agt_sec_b", run: "run_sec_a", recording: "rec_sec_a" };
const look = { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" };
const tools = { notifyOwner: true, slack: false, slackChannels: [] };

async function cleanup() {
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  await db.delete(schema.user).where(like(schema.user.email, "%@sec.test"));
  await db.delete(schema.user).where(eq(schema.user.id, ids.owner));
  await db.delete(schema.hosts).where(like(schema.hosts.id, "sec-%"));
}

before(async () => {
  if (!url) return;
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  await (await import("./test-db")).migrateTestDb();
  await cleanup();
  await db.insert(schema.user).values({ id: ids.owner, name: "Owner", email: "owner@sec.local", status: "approved" });
  await db.insert(schema.agents).values([
    { id: ids.agentA, ownerId: ids.owner, name: "A", look, tokenHash: "sec_hash_a", tools } as never,
    { id: ids.agentB, ownerId: ids.owner, name: "B", look, tokenHash: "sec_hash_b", tools } as never,
  ]);
});

after(async () => {
  if (!url) return;
  await cleanup();
  const { getPool } = await import("@/lib/db");
  await getPool().end();
  setTimeout(() => process.exit(0), 100).unref();
});

async function signUp(email: string, extra: Record<string, unknown> = {}) {
  const { getAuth } = await import("@/lib/auth");
  const res = await getAuth().handler(
    new Request("http://localhost:3999/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3999" },
      body: JSON.stringify({ email, password: "a-long-password", name: "X", ...extra }),
    }),
  );
  const { getDb, schema } = await import("@/lib/db");
  const [row] = await getDb().select().from(schema.user).where(eq(schema.user.email, email));
  return { status: res.status, row };
}

test("signing up with an admin-listed email is refused", { skip }, async () => {
  const { status, row } = await signUp("boss@sec.test");
  assert.equal(status, 403);
  assert.equal(row, undefined);
});

test("a sign-up cannot set its own status, admin flag or origin", { skip }, async () => {
  let n = 0;
  for (const extra of [{ status: "approved" }, { admin: true }, { source: "admin" }, { emailVerified: true }]) {
    const { status, row } = await signUp(`forger${n++}@sec.test`, extra);
    if (status !== 200) {
      assert.equal(row, undefined);
      continue;
    }
    assert.equal(row.status, "pending", JSON.stringify(extra));
    assert.equal(row.admin, false);
    assert.equal(row.source, "sign_up");
    assert.equal(row.emailVerified, false);
  }
});

test("a sign-up waits for approval and is never admin", { skip }, async () => {
  const { status, row } = await signUp("someone@sec.test", { emailVerified: true });
  assert.equal(status, 200);
  assert.equal(row.status, "pending");
  assert.equal(row.admin, false);
  assert.equal(row.source, "sign_up");
  assert.equal(row.emailVerified, false);
  const { isAdmin } = await import("@/lib/env");
  process.env.UNDERSTUDY_ADMIN_EMAILS = "boss@sec.test,cli-boss@sec.test,someone@sec.test";
  assert.equal(isAdmin(row.email, row.admin, row.source), false);
  process.env.UNDERSTUDY_ADMIN_EMAILS = "boss@sec.test,cli-boss@sec.test";
});

test("public sign-up is closed when no allowed domain is set", { skip }, async () => {
  const saved = process.env.UNDERSTUDY_ALLOWED_EMAIL_DOMAIN;
  process.env.UNDERSTUDY_ALLOWED_EMAIL_DOMAIN = "";
  try {
    const { status, row } = await signUp("anyone@sec.test");
    assert.equal(status, 403);
    assert.equal(row, undefined);
  } finally {
    process.env.UNDERSTUDY_ALLOWED_EMAIL_DOMAIN = saved;
  }
});

test("accounts created by an admin or the CLI are approved, and admin only when listed", { skip }, async () => {
  const { createUserWithPassword } = await import("@/lib/users");
  const { isAdmin } = await import("@/lib/env");
  const listed = await createUserWithPassword({ email: "cli-boss@sec.test", name: "Boss", password: "a-long-password" });
  const plain = await createUserWithPassword({ email: "plain@sec.test", name: "Plain", password: "a-long-password" });
  const { getDb, schema } = await import("@/lib/db");
  const rows = await getDb().select().from(schema.user).where(inArray(schema.user.id, [listed.id, plain.id]));
  const boss = rows.find((r) => r.id === listed.id)!;
  const other = rows.find((r) => r.id === plain.id)!;
  assert.equal(boss.status, "approved");
  assert.equal(boss.source, "admin");
  assert.equal(isAdmin(boss.email, boss.admin, boss.source), true);
  assert.equal(other.status, "approved");
  assert.equal(isAdmin(other.email, other.admin, other.source), false);
});

test("the brain cannot lower how many runs ask; the owner's value survives a re-recording", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { Hub } = await import("./hub");
  const { normalizeRecipe, DEFAULT_ASK_FIRST_RUNS } = await import("@understudy/protocol");
  const db = getDb();
  await db.insert(schema.recordings).values({ id: ids.recording, agentId: ids.agentA, status: "processing" });
  const hub = new Hub();
  const first = await hub.recordings.saveRecipe(ids.agentA, ids.recording, normalizeRecipe({ steps: [{ text: "Open" }], askFirstRuns: 0 }));
  assert.equal(first?.recipe.askFirstRuns, DEFAULT_ASK_FIRST_RUNS);
  const [stored] = await db.select().from(schema.recipes).where(eq(schema.recipes.id, first!.id));
  await db.update(schema.recipes).set({ recipe: { ...stored.recipe, askFirstRuns: 7 } }).where(eq(schema.recipes.id, first!.id));
  const again = await hub.recordings.saveRecipe(ids.agentA, ids.recording, normalizeRecipe({ steps: [{ text: "Open" }], askFirstRuns: 0 }));
  assert.equal(again?.recipe.askFirstRuns, 7);
});

test("a run record cannot point at another agent's approval", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { Hub } = await import("./hub");
  const db = getDb();
  const hub = new Hub();
  await db.insert(schema.runs).values({ id: ids.run, agentId: ids.agentA, trigger: "manual" });
  const mine = await hub.createApproval(ids.agentA, { summary: "mine", runId: ids.run }, "mcp", 3600);
  const theirs = await hub.createApproval(ids.agentB, { summary: "theirs", runId: "" }, "mcp", 3600);
  await hub.runs.saveRecord(ids.agentA, ids.run, [
    { at: 1, text: "a", approvalId: mine },
    { at: 2, text: "b", approvalId: theirs },
  ] as never, []);
  const [record] = await db.select().from(schema.runRecords).where(eq(schema.runRecords.runId, ids.run));
  assert.deepEqual(record.steps.map((s) => s.approvalId), [mine, undefined]);
});

test("the first host is pinned, strangers are refused, and agents stay on their host", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { Hub } = await import("./hub");
  const db = getDb();
  await db.delete(schema.hosts);
  const hub = new Hub();
  assert.equal(await hub.hosts.admit("sec-host-1"), true);
  assert.equal(await hub.hosts.admit("sec-host-2"), false);
  assert.equal(await hub.hosts.admit("sec-host-1"), true);
  const [refused] = await db.select().from(schema.hosts).where(eq(schema.hosts.id, "sec-host-2"));
  assert.equal(refused.trusted, false);

  const sent: unknown[] = [];
  const fakeWs = { readyState: 1, OPEN: 1, send: (m: string) => sent.push(JSON.parse(m)), close() {}, ping() {} };
  const conn = (hostId: string) => ({ ws: fakeWs as never, hostId, capacity: 5, running: new Set<string>() });
  assert.equal(await hub.hosts.ensure(ids.agentA, conn("sec-host-1")), true);
  const [bound] = await db.select().from(schema.agents).where(eq(schema.agents.id, ids.agentA));
  assert.equal(bound.hostId, "sec-host-1");
  const tokenBefore = bound.tokenHash;
  assert.equal(await hub.hosts.ensure(ids.agentA, conn("sec-host-2")), false);
  const [after] = await db.select().from(schema.agents).where(eq(schema.agents.id, ids.agentA));
  assert.equal(after.tokenHash, tokenBefore);
  assert.equal(sent.length, 1);
});

test("an allowlist overrides pinning", { skip }, async () => {
  const { Hub } = await import("./hub");
  process.env.UNDERSTUDY_HOST_IDS = "sec-host-3";
  try {
    const hub = new Hub();
    assert.equal(await hub.hosts.admit("sec-host-3"), true);
    assert.equal(await hub.hosts.admit("sec-host-1"), false);
  } finally {
    delete process.env.UNDERSTUDY_HOST_IDS;
  }
});
