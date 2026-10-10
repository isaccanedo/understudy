import assert from "node:assert/strict";
import { test } from "node:test";
import { canRead, canUpload } from "./access";
import { contentDisposition, fileHeaders, matchFileRoute, uploadErrorStatus } from "./routes";
import { UPLOAD_TTL_MS, Uploads } from "./uploads";

const attachment = { path: "inbox/a.png", name: "a.png", size: 3, mime: "image/png" };

test("file routes match only their own shapes", () => {
  assert.deepEqual(matchFileRoute("POST", "/api/files/agt_1/uploads"), { kind: "create", agentId: "agt_1" });
  assert.deepEqual(matchFileRoute("PUT", "/api/files/agt_1/uploads/up_x"), { kind: "chunk", agentId: "agt_1", uploadId: "up_x" });
  assert.deepEqual(matchFileRoute("GET", "/api/files/agt_1/uploads/up_x"), { kind: "status", agentId: "agt_1", uploadId: "up_x" });
  assert.deepEqual(matchFileRoute("DELETE", "/api/files/agt_1/uploads/up_x"), { kind: "cancel", agentId: "agt_1", uploadId: "up_x" });
  assert.deepEqual(matchFileRoute("POST", "/api/files/agt_1/uploads/up_x/finish"), { kind: "finish", agentId: "agt_1", uploadId: "up_x" });
  assert.deepEqual(matchFileRoute("HEAD", "/api/files/agt_1/raw"), { kind: "raw", agentId: "agt_1" });
  assert.deepEqual(matchFileRoute("GET", "/api/files/agt_1/thumb"), { kind: "thumb", agentId: "agt_1" });
  for (const [method, path] of [["GET", "/api/files/agt_1/uploads"], ["POST", "/api/files/agt_1/raw"], ["GET", "/api/files/../raw"], ["GET", "/api/files/agt_1/raw/x"], ["PUT", "/api/files/agt_1/uploads/up_x/finish"], ["GET", "/api/files/agt_1/other"]]) {
    assert.equal(matchFileRoute(method, path), null, `${method} ${path}`);
  }
});

test("served files never run: nosniff, sandboxed, html and svg only as downloads", () => {
  for (const name of ["page.html", "logo.svg", "run.js", "data.json"]) {
    const headers = fileHeaders(name, false);
    assert.equal(headers["Content-Type"], "application/octet-stream", name);
    assert.match(headers["Content-Disposition"], /^attachment;/, name);
    assert.match(headers["Content-Security-Policy"], /sandbox/);
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
  }
  const video = fileHeaders("clip.mp4", false);
  assert.equal(video["Content-Type"], "video/mp4");
  assert.match(video["Content-Disposition"], /^inline;/);
  assert.match(video["Content-Security-Policy"], /default-src 'none'/);
  assert.equal(video["Accept-Ranges"], "bytes");
  assert.match(fileHeaders("clip.mp4", true)["Content-Disposition"], /^attachment;/);
  assert.match(fileHeaders("doc.pdf", false)["Content-Security-Policy"], /default-src 'none'/);
  assert.equal(contentDisposition('relatório "final".pdf', true), `inline; filename="relat_rio _final_.pdf"; filename*=UTF-8''relat%C3%B3rio%20%22final%22.pdf`);
});

test("computer errors map to clear HTTP statuses", () => {
  assert.equal(uploadErrorStatus(undefined), 200);
  assert.equal(uploadErrorStatus("disk_full"), 507);
  assert.equal(uploadErrorStatus("too_large"), 413);
  assert.equal(uploadErrorStatus("gap"), 409);
  assert.equal(uploadErrorStatus("offline"), 503);
  assert.equal(uploadErrorStatus("unknown_upload"), 404);
});

test("only the owner uploads; approvers and viewers read only what was posted in the chat", () => {
  assert.equal(canUpload("owner"), true);
  assert.equal(canUpload("approver"), false);
  assert.equal(canUpload("viewer"), false);
  assert.equal(canUpload(null), false);
  assert.equal(canRead("owner", "outbox/anything.zip", false), true);
  assert.equal(canRead("owner", "../.claude.json", false), false);
  assert.equal(canRead("approver", "outbox/report.pdf", false), false);
  assert.equal(canRead("approver", "outbox/report.pdf", true), true);
  assert.equal(canRead("viewer", "inbox/a.png", true), true);
  assert.equal(canRead("viewer", "skills/a.md", true), false);
  assert.equal(canRead(null, "inbox/a.png", true), false);
});

test("an upload can only be attached by the user who made it, on the same understudy, once it finished, once", () => {
  let now = 1_000;
  const uploads = new Uploads(() => now);
  const mine = uploads.create("agt_a", "usr_1", "../../a.png", 3);
  const pending = uploads.create("agt_a", "usr_1", "b.png", 3);
  assert.equal(mine.name, "a.png");
  uploads.finish(mine.id, attachment);
  assert.deepEqual(uploads.claim("agt_a", "usr_2", [mine.id]), []);
  assert.deepEqual(uploads.claim("agt_b", "usr_1", [mine.id]), []);
  assert.deepEqual(uploads.claim("agt_a", "usr_1", [pending.id, 42, mine.id, mine.id]), [attachment]);
  assert.deepEqual(uploads.claim("agt_a", "usr_1", [mine.id]), []);
  assert.deepEqual(uploads.claim("agt_a", "usr_1", "nope"), []);
  const late = uploads.create("agt_a", "usr_1", "c.png", 3);
  uploads.finish(late.id, attachment);
  now += UPLOAD_TTL_MS + 1;
  assert.deepEqual(uploads.claim("agt_a", "usr_1", [late.id]), []);
});
