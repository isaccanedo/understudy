import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { like } from "drizzle-orm";
import type { Attachment, ServerToComputer } from "@understudy/protocol";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";
if (url) process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";
process.env.UNDERSTUDY_PUBLIC_URL = "http://localhost:3998";
process.env.UNDERSTUDY_ALLOWED_EMAIL_DOMAIN = "files.test";
process.env.UNDERSTUDY_ADMIN_EMAILS = "";
process.env.UNDERSTUDY_UPLOAD_MAX_BYTES = String(64 * 1024 * 1024);

const ORIGIN = "http://localhost:3998";
const agentId = "agt_files_a";
const look = { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" };
const tools = { notifyOwner: true, slack: false, slackChannels: [] };

type Disk = Map<string, Buffer>;
const disk: Disk = new Map();
const partials = new Map<string, { name: string; size: number; data: Buffer }>();
let freeBytes = Number.MAX_SAFE_INTEGER;
let server: Server;
let base = "";
let hub: { uploads: import("./uploads").Uploads; sent: ServerToComputer[] };
const cookies: Record<string, string> = {};

function fakeHub() {
  const sent: ServerToComputer[] = [];
  return {
    sent,
    uploads: null as unknown as import("./uploads").Uploads,
    isOnline: () => true,
    sendToComputer: (_agent: string, message: ServerToComputer) => (sent.push(message), true),
    async askComputer(_agent: string, message: ServerToComputer) {
      sent.push(message);
      if (message.type === "upload_open") {
        const existing = partials.get(message.uploadId);
        if (existing) return { type: "upload_state", requestId: message.requestId, uploadId: message.uploadId, received: existing.data.length };
        if (message.size > freeBytes) return { type: "upload_state", requestId: message.requestId, uploadId: message.uploadId, received: 0, free: freeBytes, error: "disk_full" };
        partials.set(message.uploadId, { name: message.name, size: message.size, data: Buffer.alloc(0) });
        return { type: "upload_state", requestId: message.requestId, uploadId: message.uploadId, received: 0 };
      }
      if (message.type === "upload_chunk") {
        const part = partials.get(message.uploadId)!;
        if (message.offset > part.data.length) return { type: "upload_state", requestId: message.requestId, uploadId: message.uploadId, received: part.data.length, error: "gap" };
        part.data = Buffer.concat([part.data.subarray(0, message.offset), Buffer.from(message.base64, "base64")]);
        return { type: "upload_state", requestId: message.requestId, uploadId: message.uploadId, received: part.data.length };
      }
      if (message.type === "upload_finish") {
        const part = partials.get(message.uploadId)!;
        const attachment: Attachment = { path: `inbox/${part.name}`, name: part.name, size: part.size, mime: "video/mp4" };
        disk.set(attachment.path, part.data);
        return { type: "upload_done", requestId: message.requestId, uploadId: message.uploadId, attachment };
      }
      if (message.type === "file_read") {
        const data = disk.get(message.path);
        if (!data) return { type: "file_chunk", requestId: message.requestId, error: "not_found" };
        return { type: "file_chunk", requestId: message.requestId, size: data.length, base64: data.subarray(message.offset, message.offset + message.length).toString("base64") };
      }
      return { type: "failed", error: "timeout" };
    },
  };
}

async function signIn(email: string) {
  const { getAuth } = await import("@/lib/auth");
  const res = await getAuth().handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ email, password: "a-long-password" }),
    }),
  );
  assert.equal(res.status, 200, await res.clone().text());
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function cleanup() {
  const { getDb, schema } = await import("@/lib/db");
  await getDb().delete(schema.user).where(like(schema.user.email, "%@files.test"));
}

before(async () => {
  if (!url) return;
  await (await import("../test-db")).migrateTestDb();
  await cleanup();
  const { createUserWithPassword } = await import("@/lib/users");
  const { getDb, schema } = await import("@/lib/db");
  const owner = await createUserWithPassword({ email: "owner@files.test", name: "Owner", password: "a-long-password", mustChangePassword: false });
  const viewer = await createUserWithPassword({ email: "viewer@files.test", name: "Viewer", password: "a-long-password", mustChangePassword: false });
  await createUserWithPassword({ email: "stranger@files.test", name: "Stranger", password: "a-long-password", mustChangePassword: false });
  await getDb().insert(schema.agents).values({ id: agentId, ownerId: owner.id, name: "Files", look, tokenHash: "files_hash_a", tools } as never);
  await getDb().insert(schema.agentMembers).values({ agentId, userId: viewer.id, role: "viewer" });
  for (const who of ["owner", "viewer", "stranger"]) cookies[who] = await signIn(`${who}@files.test`);
  const { Uploads } = await import("./uploads");
  const { createFileRoutes } = await import("./routes");
  const fake = fakeHub();
  fake.uploads = new Uploads();
  hub = fake as never;
  const routes = createFileRoutes(fake as never);
  server = createServer((req, res) => void routes.handle(req, res, new URL(req.url ?? "/", "http://localhost")));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/files/${agentId}`;
});

after(async () => {
  if (!url) return;
  server?.close();
  await cleanup();
  const { getPool } = await import("@/lib/db");
  await getPool().end();
  setTimeout(() => process.exit(0), 100).unref();
});

function call(who: string, path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, { ...init, headers: { Cookie: cookies[who] ?? "", Origin: ORIGIN, ...(init.headers ?? {}) } });
}

async function uploadAs(who: string, name: string, data: Buffer, chunk = 1024 * 1024) {
  const created = await call(who, "/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, size: data.length }) });
  if (created.status !== 200) return { status: created.status, body: await created.json() };
  const { uploadId } = (await created.json()) as { uploadId: string };
  for (let offset = 0; offset < data.length; offset += chunk) {
    const res = await call(who, `/uploads/${uploadId}?offset=${offset}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(data.subarray(offset, offset + chunk)) });
    assert.equal(res.status, 200);
  }
  const finished = await call(who, `/uploads/${uploadId}/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  return { status: finished.status, body: (await finished.json()) as { uploadId: string; attachment: Attachment }, uploadId };
}

test("the owner streams a file up in chunks and it is passed to the computer byte for byte", { skip }, async () => {
  const data = Buffer.alloc(5 * 1024 * 1024 + 123);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 251;
  const result = await uploadAs("owner", "demo.mp4", data);
  assert.equal(result.status, 200);
  assert.equal(result.body.attachment.path, "inbox/demo.mp4");
  assert.ok(disk.get("inbox/demo.mp4")?.equals(data));
  const chunks = hub.sent.filter((m) => m.type === "upload_chunk");
  assert.equal(chunks.length, 6);
});

test("uploads over the limit, onto a full disk, with a gap or from someone else are refused", { skip }, async () => {
  const big = await call("owner", "/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "big.mov", size: 65 * 1024 * 1024 }) });
  assert.equal(big.status, 413);
  assert.equal(((await big.json()) as { max: number }).max, 64 * 1024 * 1024);
  freeBytes = 10;
  const full = await call("owner", "/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "a.mov", size: 100 }) });
  assert.equal(full.status, 507);
  assert.deepEqual(await full.json(), { error: "disk_full", free: 10 });
  freeBytes = Number.MAX_SAFE_INTEGER;
  const created = await call("owner", "/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "gap.bin", size: 10 }) });
  const { uploadId } = (await created.json()) as { uploadId: string };
  const gap = await call("owner", `/uploads/${uploadId}?offset=5`, { method: "PUT", body: "xxxxx" });
  assert.equal(gap.status, 409);
  assert.equal(((await gap.json()) as { received: number }).received, 0);
  const status = await call("owner", `/uploads/${uploadId}`);
  assert.deepEqual(await status.json(), { received: 0 });
  assert.equal((await call("viewer", `/uploads/${uploadId}?offset=0`, { method: "PUT", body: "x" })).status, 404);
  assert.equal((await call("viewer", "/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "v.png", size: 1 }) })).status, 404);
  assert.equal((await call("stranger", "/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "s.png", size: 1 }) })).status, 404);
  assert.equal((await fetch(`${base}/uploads`, { method: "POST", headers: { Cookie: cookies.owner, Origin: "https://evil.example" }, body: "{}" })).status, 403);
  assert.equal((await call("owner", `/uploads/${uploadId}`, { method: "DELETE" })).status, 200);
  assert.equal((await call("owner", `/uploads/${uploadId}`)).status, 404);
});

test("downloads stream with ranges, safe headers and the right access for each role", { skip }, async () => {
  const data = Buffer.from("0123456789".repeat(1000));
  disk.set("outbox/cut.mp4", data);
  disk.set("outbox/private.html", Buffer.from("<script>alert(1)</script>"));
  const full = await call("owner", "/raw?path=outbox/cut.mp4");
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("x-content-type-options"), "nosniff");
  assert.ok(Buffer.from(await full.arrayBuffer()).equals(data));
  const part = await call("owner", "/raw?path=outbox/cut.mp4", { headers: { Range: "bytes=10-19" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 10-19/${data.length}`);
  assert.equal(await part.text(), "0123456789");
  assert.equal((await call("owner", "/raw?path=outbox/cut.mp4", { headers: { Range: "bytes=999999-" } })).status, 416);
  const html = await call("owner", "/raw?path=outbox/private.html");
  assert.equal(html.headers.get("content-type"), "application/octet-stream");
  assert.match(html.headers.get("content-disposition") ?? "", /^attachment/);
  assert.match(html.headers.get("content-security-policy") ?? "", /sandbox/);
  assert.equal((await call("owner", "/raw?path=../.claude.json")).status, 400);
  assert.equal((await call("viewer", "/raw?path=outbox/cut.mp4")).status, 404);
  assert.equal((await call("stranger", "/raw?path=outbox/cut.mp4")).status, 404);
  assert.equal((await fetch(`${base}/raw?path=outbox/cut.mp4`)).status, 404);
  const { getDb, schema } = await import("@/lib/db");
  await getDb().insert(schema.messages).values({ id: "msg_files_1", agentId, role: "agent", text: "", attachments: [{ path: "outbox/cut.mp4", name: "cut.mp4", size: data.length, mime: "video/mp4" }] });
  const shared = await call("viewer", "/raw?path=outbox/cut.mp4", { headers: { Range: "bytes=0-3" } });
  assert.equal(shared.status, 206);
  assert.equal(await shared.text(), "0123");
  assert.equal((await call("viewer", "/raw?path=outbox/private.html")).status, 404);
  assert.equal((await call("stranger", "/raw?path=outbox/cut.mp4")).status, 404);
});

test("a finished upload is attached to the owner's chat message and the agent is told where it is", { skip }, async () => {
  const result = await uploadAs("owner", "shot.png", Buffer.from("png"));
  const { handleViewerMessage } = await import("../hub/viewer-handlers");
  const { getDb, schema } = await import("@/lib/db");
  const added: { text: string; attachments?: Attachment[] }[] = [];
  const delivered: ServerToComputer[] = [];
  const owner = (await getDb().select().from(schema.user).where(like(schema.user.email, "owner@files.test")))[0];
  const ctx = {
    hub: {
      uploads: hub.uploads,
      addMessage: async (_a: string, _r: string, text: string, _run: unknown, _author: unknown, _via: unknown, _stream: unknown, attachments?: Attachment[]) => void added.push({ text, attachments }),
      deliver: async (_a: string, message: ServerToComputer) => (delivered.push(message), { status: "sent" }),
    },
    agentId,
    userId: owner.id,
    offline: () => {},
    refuse: () => {},
  };
  await handleViewerMessage(ctx as never, { type: "chat", text: "what is this?", attachments: [result.uploadId!] });
  assert.deepEqual(added, [{ text: "what is this?", attachments: [result.body.attachment] }]);
  assert.deepEqual(delivered, [{ type: "chat", text: "what is this?", from: "Owner", attachments: [result.body.attachment] }]);
  await handleViewerMessage(ctx as never, { type: "chat", text: "", attachments: [result.uploadId!] });
  assert.equal(added.length, 1);
});
