import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { inArray, like } from "drizzle-orm";
import type { ServerToComputer } from "@understudy/protocol";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";
if (url) process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";
process.env.UNDERSTUDY_PUBLIC_URL = "http://localhost:3997";
process.env.UNDERSTUDY_ARTIFACT_MAX_BYTES = String(1024 * 1024);
process.env.UNDERSTUDY_ARTIFACT_AGENT_MAX_BYTES = String(3 * 1024 * 1024);
delete process.env.UNDERSTUDY_ARTIFACT_S3_BUCKET;

const agentId = "agt_artifacts_a";
const otherAgentId = "agt_artifacts_b";
const look = { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" };
const tools = { notifyOwner: true, slack: false, slackChannels: [] };
const disk = new Map<string, Buffer>();
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
let server: Server;
let base = "";

function fakeHub() {
  const sent: ServerToComputer[] = [];
  return {
    sent,
    sendToComputer: (_agent: string, message: ServerToComputer) => (sent.push(message), true),
    async askComputer(_agent: string, message: ServerToComputer) {
      sent.push(message);
      if (message.type === "file_share") {
        const name = message.path.split("/").pop()!;
        const path = `outbox/${name}`;
        const data = disk.get(path);
        if (!data) return { type: "file_shared", requestId: message.requestId, error: `no such file: ${message.path}` };
        return { type: "file_shared", requestId: message.requestId, attachment: { path, name, size: data.length, mime: "application/octet-stream" } };
      }
      if (message.type === "file_read") {
        const data = disk.get(message.path);
        if (!data) return { type: "file_chunk", requestId: message.requestId, error: "not_found" };
        return { type: "file_chunk", requestId: message.requestId, size: data.length, base64: data.subarray(message.offset, message.offset + message.length).toString("base64") };
      }
      if (message.type === "artifact_render") return { type: "artifact_rendered", requestId: message.requestId, key: "c".repeat(32), pages: 2 };
      if (message.type === "artifact_page") return { type: "file_chunk", requestId: message.requestId, size: JPEG.length, base64: JPEG.toString("base64") };
      return { type: "failed", error: "timeout" };
    },
  };
}

async function cleanup() {
  const { getDb, schema } = await import("@/lib/db");
  await getDb().delete(schema.artifactBlobs).where(like(schema.artifactBlobs.key, "artifacts/%"));
  await getDb().delete(schema.agents).where(inArray(schema.agents.id, [agentId, otherAgentId]));
  await getDb().delete(schema.user).where(like(schema.user.email, "%@artifacts.test"));
}

before(async () => {
  if (!url) return;
  await (await import("../test-db")).migrateTestDb();
  await cleanup();
  const { createUserWithPassword } = await import("@/lib/users");
  const { getDb, schema } = await import("@/lib/db");
  const owner = await createUserWithPassword({ email: "owner@artifacts.test", name: "Owner", password: "a-long-password", mustChangePassword: false });
  await getDb().insert(schema.agents).values({ id: agentId, ownerId: owner.id, name: "Maker", look, tokenHash: "artifacts_hash_a", tools } as never);
  await getDb().insert(schema.agents).values({ id: otherAgentId, ownerId: owner.id, name: "Other", look, tokenHash: "artifacts_hash_b", tools } as never);
  const { handleArtifactContent } = await import("./routes");
  server = createServer((req, res) => void handleArtifactContent(req, res, new URL(req.url ?? "/", "http://localhost")));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (!url) return;
  server?.close();
  await cleanup();
  const { getPool } = await import("@/lib/db");
  await getPool().end();
  setTimeout(() => process.exit(0), 100).unref();
});

const pathOf = (contentUrl: string) => contentUrl.replace(/^https?:\/\/[^/]+/, "");

test("an HTML artifact is snapshotted into the panel and served isolated with the bridge first", { skip }, async () => {
  const { publishArtifact, loadArtifactView } = await import("./service");
  disk.set("outbox/calculator.html", Buffer.from('<!doctype html><html><head><title>Price check</title></head><body><script>fetch("https://api.example.com")</script></body></html>'));
  const hub = fakeHub();
  const result = await publishArtifact(hub as never, agentId, { path: "~/files/outbox/calculator.html", title: "  Price   check ", note: "first draft" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.version, 1);
  assert.equal(result.card.title, "Price check");
  assert.equal(result.card.kind, "html");
  const view = await loadArtifactView(agentId, result.artifactId);
  assert.ok(view);
  assert.equal(view!.version.note, "first draft");
  disk.set("outbox/calculator.html", Buffer.from("<p>changed on the computer later</p>"));

  const res = await fetch(`${base}${pathOf(view!.contentUrl)}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy") ?? "", /^sandbox allow-scripts;.*connect-src 'none'.*frame-ancestors http:\/\/localhost:3997/);
  const body = await res.text();
  assert.ok(body.indexOf('understudy:"artifact"') < body.indexOf("<title>"));
  assert.match(body, /fetch\("https:\/\/api\.example\.com"\)/);
  assert.doesNotMatch(body, /changed on the computer later/);

  const download = await fetch(`${base}${pathOf(view!.downloadUrl)}`);
  assert.equal(download.headers.get("content-type"), "application/octet-stream");
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.doesNotMatch(await download.text(), /understudy:"artifact"/);

  const forged = pathOf(view!.contentUrl).replace(/\.[^.]+$/, ".forged");
  assert.equal((await fetch(`${base}${forged}`)).status, 404);
});

test("publishing with the artifact id adds a version and old versions stay readable", { skip }, async () => {
  const { publishArtifact, loadArtifactView, listArtifacts } = await import("./service");
  disk.set("outbox/brief.md", Buffer.from("# Renewal brief\n\nRenewals start 60 days before the end."));
  const hub = fakeHub();
  const first = await publishArtifact(hub as never, agentId, { path: "outbox/brief.md", title: "Renewal brief" });
  assert.ok(first.ok);
  if (!first.ok) return;
  disk.set("outbox/brief.md", Buffer.from("# Renewal brief\n\nRenewals now start 60 days before the end, because early contact gets answers."));
  const second = await publishArtifact(hub as never, agentId, { path: "outbox/brief.md", title: "Renewal brief", artifactId: first.artifactId, note: "explained the earlier start" });
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.version, 2);
  assert.equal(second.artifactId, first.artifactId);
  const latest = await loadArtifactView(agentId, first.artifactId);
  assert.equal(latest!.latestVersion, 2);
  assert.deepEqual(latest!.versions.map((v) => v.version), [2, 1]);
  assert.match(latest!.markdown ?? "", /because early contact/);
  const old = await loadArtifactView(agentId, first.artifactId, 1);
  assert.equal(old!.version.version, 1);
  assert.doesNotMatch(old!.markdown ?? "", /because/);
  const list = await listArtifacts(agentId);
  assert.equal(list[0].id, first.artifactId);
  assert.equal(list[0].latestVersion, 2);
  assert.equal(await loadArtifactView(otherAgentId, first.artifactId), null);
});

test("office files and PDFs become page images on the computer", { skip }, async () => {
  const { publishArtifact, loadArtifactView } = await import("./service");
  disk.set("outbox/week-41.pptx", Buffer.from("PK fake pptx"));
  const hub = fakeHub();
  const result = await publishArtifact(hub as never, agentId, { path: "outbox/week-41.pptx", title: "Renewal fixes, week 41" });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.card.pages, 2);
  assert.ok(hub.sent.some((m) => m.type === "artifact_render" && m.path === "outbox/week-41.pptx"));
  const view = await loadArtifactView(agentId, result.artifactId);
  assert.equal(view!.pageUrls.length, 2);
  const page = await fetch(`${base}${pathOf(view!.pageUrls[1])}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await page.arrayBuffer()), JPEG);
  assert.equal((await fetch(`${base}${pathOf(view!.pageUrls[1]).replace(/2$/, "3")}`)).status, 404);
  const original = await fetch(`${base}${pathOf(view!.contentUrl)}`);
  assert.equal(original.headers.get("content-type"), "application/octet-stream");
  assert.match(original.headers.get("content-disposition") ?? "", /^attachment;/);
});

test("unsupported, oversized, missing and foreign artifacts are refused with a reason", { skip }, async () => {
  const { publishArtifact } = await import("./service");
  const hub = fakeHub();
  disk.set("outbox/data.csv", Buffer.from("a,b\n1,2"));
  const csv = await publishArtifact(hub as never, agentId, { path: "outbox/data.csv", title: "Data" });
  assert.equal(csv.ok, false);
  assert.match(!csv.ok ? csv.error : "", /share_file/);
  disk.set("outbox/huge.html", Buffer.alloc(2 * 1024 * 1024, 32));
  const huge = await publishArtifact(hub as never, agentId, { path: "outbox/huge.html", title: "Huge" });
  assert.match(!huge.ok ? huge.error : "", /at most/);
  const missing = await publishArtifact(hub as never, agentId, { path: "outbox/nope.html", title: "Nope" });
  assert.match(!missing.ok ? missing.error : "", /no such file/);
  disk.set("outbox/x.html", Buffer.from("<p>x</p>"));
  const mine = await publishArtifact(hub as never, agentId, { path: "outbox/x.html", title: "Mine" });
  assert.ok(mine.ok);
  const foreign = await publishArtifact(hub as never, otherAgentId, { path: "outbox/x.html", title: "Steal", artifactId: mine.ok ? mine.artifactId : "" });
  assert.match(!foreign.ok ? foreign.error : "", /no artifact/);
  const untitled = await publishArtifact(hub as never, agentId, { path: "outbox/x.html", title: "   " });
  assert.equal(untitled.ok, false);
});

test("an edit request puts the exact version back on the computer and names it", { skip }, async () => {
  const { publishArtifact, prepareEdit } = await import("./service");
  disk.set("outbox/page.html", Buffer.from("<h1>v1</h1>"));
  const hub = fakeHub();
  const result = await publishArtifact(hub as never, agentId, { path: "outbox/page.html", title: "Landing page" });
  assert.ok(result.ok);
  if (!result.ok) return;
  const prepared = await prepareEdit(hub as never, agentId, { artifactId: result.artifactId, version: 1, quote: "  v1 \n\n ok ", page: 9 });
  assert.ok(prepared);
  assert.equal(prepared!.path, `inbox/artifacts/${result.artifactId}/v1/page.html`);
  assert.deepEqual(prepared!.card.edit, { quote: "v1 ok" });
  const put = hub.sent.find((m) => m.type === "file_put");
  assert.ok(put && put.type === "file_put");
  assert.equal(put.path, `artifacts/${result.artifactId}/v1/page.html`);
  assert.equal(Buffer.from(put.base64, "base64").toString(), "<h1>v1</h1>");
  assert.equal(await prepareEdit(hub as never, otherAgentId, { artifactId: result.artifactId, version: 1 }), null);
  assert.equal(await prepareEdit(hub as never, agentId, { artifactId: result.artifactId, version: 7 }), null);
});

test("the owner's chat edit reaches the computer as a structured request", { skip }, async () => {
  const { publishArtifact } = await import("./service");
  const { viewerHandlers } = await import("../hub/viewer-handlers");
  disk.set("outbox/notes.md", Buffer.from("# Notes"));
  const computer = fakeHub();
  const published = await publishArtifact(computer as never, agentId, { path: "outbox/notes.md", title: "Notes" });
  assert.ok(published.ok);
  if (!published.ok) return;
  const added: unknown[][] = [];
  const delivered: ServerToComputer[] = [];
  const refused: string[] = [];
  const hub = {
    ...computer,
    uploads: { claim: () => [] },
    addMessage: async (...args: unknown[]) => (added.push(args), "msg_1"),
    deliver: async (_agent: string, message: ServerToComputer) => (delivered.push(message), { status: "delivered" }),
  };
  const ctx = { hub: hub as never, agentId, userId: "nobody", offline: () => {}, refuse: (text: string) => refused.push(text) };
  await viewerHandlers.chat(ctx, { type: "chat", text: "Shorter title", artifactEdit: { artifactId: published.artifactId, version: 1, quote: "Notes" } });
  assert.equal(delivered.length, 1);
  const message = delivered[0];
  assert.ok(message.type === "chat" && message.artifactEdit);
  assert.equal(message.text, "Shorter title");
  assert.deepEqual(message.artifactEdit, { artifactId: published.artifactId, version: 1, title: "Notes", path: `inbox/artifacts/${published.artifactId}/v1/notes.md`, quote: "Notes" });
  assert.equal((added[0][8] as { artifactId: string }).artifactId, published.artifactId);
  await viewerHandlers.chat(ctx, { type: "chat", text: "x", artifactEdit: { artifactId: "art_doesnotexist", version: 1 } });
  await viewerHandlers.chat(ctx, { type: "chat", text: "", artifactEdit: { artifactId: published.artifactId, version: 1 } });
  await viewerHandlers.chat(ctx, { type: "chat", text: "x", artifactEdit: { artifactId: "../../x", version: 1 } as never });
  assert.equal(delivered.length, 1);
  assert.equal(refused.length, 3);
});

test("a public link shows only the version that was shared until it is revoked or expires", { skip }, async () => {
  const { publishArtifact, createShareLink, sharedArtifact, revokeShareLinks, activeShareLinks } = await import("./service");
  const { getDb, schema } = await import("@/lib/db");
  disk.set("outbox/chart.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  const hub = fakeHub();
  const first = await publishArtifact(hub as never, agentId, { path: "outbox/chart.svg", title: "Answers by week" });
  assert.ok(first.ok);
  if (!first.ok) return;
  await publishArtifact(hub as never, agentId, { path: "outbox/chart.svg", title: "Answers by week", artifactId: first.artifactId });
  const [owner] = await getDb().select().from(schema.user).where(like(schema.user.email, "owner@artifacts.test"));
  assert.equal(await createShareLink(otherAgentId, first.artifactId, 2, owner.id), null);
  assert.equal(await createShareLink(agentId, first.artifactId, 9, owner.id), null);
  const link = await createShareLink(agentId, first.artifactId, 2, owner.id);
  assert.ok(link);
  assert.match(link!.url, /^http:\/\/localhost:3997\/shared\/[A-Za-z0-9_-]{32}$/);
  const token = link!.url.split("/").pop()!;
  const rows = await getDb().select().from(schema.artifactLinks).where(like(schema.artifactLinks.artifactId, first.artifactId));
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].tokenHash, token);
  const shared = await sharedArtifact(token);
  assert.ok(shared);
  assert.equal(shared!.agentName, "Maker");
  assert.equal(shared!.agentId, "");
  assert.equal(shared!.id, "");
  assert.deepEqual(shared!.versions.map((v) => v.version), [2]);
  disk.set("outbox/chart.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>private notes</text></svg>'));
  await publishArtifact(hub as never, agentId, { path: "outbox/chart.svg", title: "Answers by week", artifactId: first.artifactId });
  const afterNewVersion = await sharedArtifact(token);
  assert.equal(afterNewVersion!.version.version, 2);
  assert.doesNotMatch(await (await fetch(`${base}${pathOf(afterNewVersion!.contentUrl)}`)).text(), /private notes/);
  const svg = await fetch(`${base}${pathOf(shared!.contentUrl)}`);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(svg.headers.get("content-security-policy") ?? "", /sandbox$/);
  assert.equal(await sharedArtifact(token, new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)), null);
  assert.equal((await activeShareLinks(agentId, first.artifactId)).length, 1);
  assert.equal((await activeShareLinks(otherAgentId, first.artifactId)).length, 0);
  assert.equal(await revokeShareLinks(agentId, first.artifactId), 1);
  assert.equal(await sharedArtifact(token), null);
  assert.equal(await sharedArtifact("not-a-token"), null);
});

test("an understudy cannot publish past its storage quota", { skip }, async () => {
  const { publishArtifact } = await import("./service");
  const hub = fakeHub();
  disk.set("outbox/big.html", Buffer.alloc(900 * 1024, 65));
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await publishArtifact(hub as never, otherAgentId, { path: "outbox/big.html", title: `Big ${i}` }));
  assert.equal(results.filter((r) => r.ok).length, 3);
  assert.match(results.at(-1)!.ok ? "" : (results.at(-1) as { error: string }).error, /already use/);
});

test("deleting an agent's artifacts removes their stored bytes", { skip }, async () => {
  const { publishArtifact, removeAgentArtifactBlobs } = await import("./service");
  const { getDb, schema } = await import("@/lib/db");
  disk.set("outbox/other.html", Buffer.from("<p>other</p>"));
  const hub = fakeHub();
  const result = await publishArtifact(hub as never, otherAgentId, { path: "outbox/other.html", title: "Other" });
  assert.ok(result.ok);
  if (!result.ok) return;
  await removeAgentArtifactBlobs(otherAgentId);
  const left = await getDb().select({ key: schema.artifactBlobs.key }).from(schema.artifactBlobs).where(like(schema.artifactBlobs.key, `artifacts/${result.artifactId}/%`));
  assert.equal(left.length, 0);
});
