import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import type { RecordedEvent, ServerToComputer } from "@understudy/protocol";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";

if (url) process.env.DATABASE_URL = url;

const ids = { owner: "usr_ext_owner", other: "usr_ext_other", agent: "agt_ext_mine", foreign: "agt_ext_theirs" };
const delivered: ServerToComputer[] = [];
const broadcasts: { agentId: string; message: { type: string } }[] = [];
let server: Server;
let base = "";

async function cleanup() {
  const { getDb, schema } = await import("@/lib/db");
  await getDb().delete(schema.user).where(inArray(schema.user.id, [ids.owner, ids.other]));
}

before(async () => {
  if (!url) return;
  const { getDb, schema } = await import("@/lib/db");
  await (await import("../test-db")).migrateTestDb();
  await cleanup();
  const db = getDb();
  await db.insert(schema.user).values([
    { id: ids.owner, name: "Owner", email: "owner-ext@test.local", status: "approved" },
    { id: ids.other, name: "Other", email: "other-ext@test.local", status: "approved" },
  ]);
  const tools = { notifyOwner: true, slack: false, slackChannels: [] };
  const look = { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" };
  await db.insert(schema.agents).values([
    { id: ids.agent, ownerId: ids.owner, name: "Mine", look, tokenHash: "hash_ext_a", tools } as never,
    { id: ids.foreign, ownerId: ids.other, name: "Theirs", look, tokenHash: "hash_ext_b", tools } as never,
  ]);
  const { createExtensionRoutes } = await import("./routes");
  const { BrowserRecordings } = await import("./browser-recordings");
  const { fakeTranscriber } = await import("./transcriber");
  const hub = {
    broadcast: (agentId: string, message: { type: string }) => broadcasts.push({ agentId, message }),
    deliver: async (_agentId: string, message: ServerToComputer) => {
      delivered.push(message);
      return { status: "sent" };
    },
    addMessage: async () => undefined,
    isOnline: () => true,
    recordings: {
      fail: async (_agentId: string, recordingId: string) => {
        await getDb().update(schema.recordings).set({ status: "failed" }).where(eq(schema.recordings.id, recordingId));
      },
    },
  } as never;
  const recordings = new BrowserRecordings(hub, () => fakeTranscriber("I export it because finance needs the CSV."));
  const routes = createExtensionRoutes(hub, { recordings });
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    routes.handle(req, res, path).catch((error) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/extension`;
});

after(async () => {
  if (!url) return;
  server.close();
  await cleanup();
  const { getPool } = await import("@/lib/db");
  await getPool().end();
});

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers });
  return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> };
}

async function pair() {
  const { createPairCode } = await import("./pairing");
  const { code } = await createPairCode(ids.owner);
  const paired = await call("/pair", { method: "POST", body: JSON.stringify({ code: code.toLowerCase().replace("-", " "), label: "Chrome on macOS" }) });
  assert.equal(paired.status, 200);
  return { code, token: String(paired.body.token) };
}

test("a pairing code becomes a token once, and the token sees only the owner's understudies", { skip }, async () => {
  const { code, token } = await pair();
  assert.match(token, /^uxt_/);
  assert.equal((await call("/pair", { method: "POST", body: JSON.stringify({ code }) })).status, 400);
  assert.equal((await call("/pair", { method: "POST", body: JSON.stringify({ code: "ZZZZ-ZZZZ" }) })).status, 400);
  assert.equal((await call("/me")).status, 401);
  assert.equal((await call("/me", { token: "uxt_not-a-real-token-at-all" })).status, 401);
  const me = await call("/me", { token });
  assert.equal(me.status, 200);
  assert.deepEqual((me.body.agents as { id: string }[]).map((agent) => agent.id), [ids.agent]);
  assert.equal((await call("/recordings", { method: "POST", token, body: JSON.stringify({ agentId: ids.foreign }) })).status, 404);
});

test("an expired code never pairs", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { createPairCode, redeemPairCode } = await import("./pairing");
  const { code } = await createPairCode(ids.owner);
  await getDb().update(schema.extensionPairCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.extensionPairCodes.userId, ids.owner));
  assert.equal(await redeemPairCode(code, "x"), null);
});

test("events and voice from the browser become one timeline sent to the computer, and the audio is deleted", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { token } = await pair();
  const started = await call("/recordings", { method: "POST", token, body: JSON.stringify({ agentId: ids.agent }) });
  assert.equal(started.status, 201);
  const recordingId = String(started.body.recordingId);
  const t0 = 1_800_000_000_000;
  const events = [
    { kind: "navigate", at: t0, url: "https://erp.example.com/reports?session=abc", title: "Reports" },
    { kind: "input", at: t0 + 1000, url: "https://erp.example.com/login", selector: "#password", label: "Password", value: "hunter2", masked: false },
    { kind: "narration", at: t0 + 1500, text: "forged" },
    { kind: "click", at: t0 + 4000, url: "https://erp.example.com/reports", selector: "#export", label: "Export CSV", x: 10, y: 20 },
  ];
  const posted = await call(`/recordings/${recordingId}/events`, { method: "POST", token, body: JSON.stringify({ events }) });
  assert.deepEqual(posted, { status: 200, body: { accepted: 3 } });
  assert.equal(broadcasts.filter((entry) => entry.message.type === "recorded").length, 3);
  const wrongType = await fetch(`${base}/recordings/${recordingId}/audio`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain", "X-Started-At": String(t0) }, body: "x" });
  assert.equal(wrongType.status, 415);
  const audio = await fetch(`${base}/recordings/${recordingId}/audio`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "audio/webm;codecs=opus", "X-Started-At": String(t0 + 3000) }, body: new Uint8Array([1, 2, 3, 4]) });
  assert.equal(audio.status, 201);
  const stored = await getDb().select().from(schema.recordingAudio).where(eq(schema.recordingAudio.recordingId, recordingId));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].startedAt, t0 + 3000);

  const stopped = await call(`/recordings/${recordingId}/stop`, { method: "POST", token });
  assert.equal(stopped.status, 202);
  for (let i = 0; i < 50 && !delivered.length; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  const message = delivered.find((item) => item.type === "teach_recording");
  assert.ok(message && message.type === "teach_recording");
  assert.equal(message.recordingId, recordingId);
  assert.equal(message.ownerBrowser, true);
  const timeline = message.events as RecordedEvent[];
  assert.deepEqual(timeline.map((event) => event.kind), ["navigate", "input", "narration", "click"]);
  assert.equal(timeline[0].kind === "navigate" && timeline[0].url, "https://erp.example.com/reports?session=…");
  assert.equal(timeline[1].kind === "input" && timeline[1].value, "••••••");
  assert.deepEqual(timeline[2], { kind: "narration", at: t0 + 3000, text: "I export it because finance needs the CSV." });
  assert.ok(!JSON.stringify(timeline).includes("hunter2"));
  assert.ok(!JSON.stringify(timeline).includes("forged"));
  assert.equal((await getDb().select().from(schema.recordingAudio).where(eq(schema.recordingAudio.recordingId, recordingId))).length, 0);
  const [recording] = await getDb().select().from(schema.recordings).where(eq(schema.recordings.id, recordingId));
  assert.equal(recording.status, "processing");
  assert.equal(recording.source, "browser");

  assert.equal((await call(`/recordings/${recordingId}/events`, { method: "POST", token, body: JSON.stringify({ events }) })).status, 409);
  assert.equal((await call(`/recordings/${recordingId}/stop`, { method: "POST", token })).status, 409);
  const status = await call(`/recordings/${recordingId}`, { token });
  assert.equal(status.body.status, "processing");
});

test("a discarded recording leaves nothing behind, and a revoked browser loses access", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { token } = await pair();
  const started = await call("/recordings", { method: "POST", token, body: JSON.stringify({ agentId: ids.agent }) });
  const recordingId = String(started.body.recordingId);
  assert.equal((await call(`/recordings/${recordingId}`, { method: "DELETE", token })).status, 200);
  assert.equal((await getDb().select().from(schema.recordings).where(eq(schema.recordings.id, recordingId))).length, 0);
  assert.equal((await call("/me", { method: "DELETE", token })).status, 200);
  assert.equal((await call("/me", { token })).status, 401);
});

test("a token stops working when its owner is no longer approved", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { token } = await pair();
  await getDb().update(schema.user).set({ status: "pending" }).where(eq(schema.user.id, ids.owner));
  try {
    assert.equal((await call("/me", { token })).status, 401);
  } finally {
    await getDb().update(schema.user).set({ status: "approved" }).where(eq(schema.user.id, ids.owner));
  }
});

test("an abandoned recording is closed and its voice deleted", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { BrowserRecordings } = await import("./browser-recordings");
  const { token } = await pair();
  const started = await call("/recordings", { method: "POST", token, body: JSON.stringify({ agentId: ids.agent }) });
  const recordingId = String(started.body.recordingId);
  await fetch(`${base}/recordings/${recordingId}/audio`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "audio/webm", "X-Started-At": "1800000000000" }, body: new Uint8Array([1]) });
  await getDb().update(schema.recordings).set({ startedAt: new Date(Date.now() - 4 * 60 * 60 * 1000) }).where(eq(schema.recordings.id, recordingId));
  const expired = await new BrowserRecordings({} as never, () => null).expireAbandoned();
  assert.ok(expired >= 1);
  const [recording] = await getDb().select().from(schema.recordings).where(eq(schema.recordings.id, recordingId));
  assert.equal(recording.status, "failed");
  assert.equal((await getDb().select().from(schema.recordingAudio).where(eq(schema.recordingAudio.recordingId, recordingId))).length, 0);
});
