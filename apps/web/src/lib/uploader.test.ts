import assert from "node:assert/strict";
import { test } from "node:test";
import type { Attachment } from "@understudy/protocol";
import { errorFromStatus, pastedName, runUpload, UploadError, type UploadTransport } from "./uploader";

class FakeBlob {
  constructor(readonly start: number, readonly end: number) {}
  get size() {
    return this.end - this.start;
  }
}

function source(size: number) {
  return { name: "clip.mp4", size, slice: (start: number, end: number) => new FakeBlob(start, end) as unknown as Blob };
}

function fakeTransport(options: { chunkBytes: number; failures?: Record<number, number>; partial?: boolean; fatalAt?: number; received?: number }) {
  const calls: string[] = [];
  let stored = options.received ?? 0;
  const failures = { ...(options.failures ?? {}) };
  const attachment: Attachment = { path: "inbox/clip.mp4", name: "clip.mp4", size: 0, mime: "video/mp4" };
  const transport: UploadTransport = {
    async create(name, size) {
      calls.push(`create ${name} ${size}`);
      return { uploadId: "up_1", chunkBytes: options.chunkBytes, received: stored };
    },
    async status() {
      calls.push(`status ${stored}`);
      return { received: stored };
    },
    async put(_id, offset, data, onProgress) {
      calls.push(`put ${offset}+${data.size}`);
      if (options.fatalAt === offset) throw new UploadError("disk_full", 507, { free: 10 });
      if (failures[offset]) {
        failures[offset]--;
        if (options.partial) stored = offset + Math.floor(data.size / 2);
        throw new UploadError("failed", 502);
      }
      onProgress(data.size);
      stored = offset + data.size;
      return { received: stored };
    },
    async finish() {
      calls.push("finish");
      return { attachment: { ...attachment, size: stored } };
    },
    async cancel() {
      calls.push("cancel");
    },
  };
  return { transport, calls };
}

const instant = async () => {};

test("a file goes up in fixed chunks, then is finished once", async () => {
  const { transport, calls } = fakeTransport({ chunkBytes: 4 });
  const progress: number[] = [];
  const attachment = await runUpload(source(10), transport, { signal: new AbortController().signal, sleep: instant, onProgress: (sent) => progress.push(sent) });
  assert.deepEqual(calls, ["create clip.mp4 10", "put 0+4", "put 4+4", "put 8+2", "finish"]);
  assert.equal(attachment.size, 10);
  assert.equal(progress.at(-1), 10);
});

test("a failed chunk is retried from where the server says it got to", async () => {
  const { transport, calls } = fakeTransport({ chunkBytes: 4, failures: { 4: 1 }, partial: true });
  await runUpload(source(12), transport, { signal: new AbortController().signal, sleep: instant });
  assert.deepEqual(calls, ["create clip.mp4 12", "put 0+4", "put 4+4", "status 6", "put 6+4", "put 10+2", "finish"]);
  const again = fakeTransport({ chunkBytes: 4, failures: { 4: 2 } });
  await runUpload(source(8), again.transport, { signal: new AbortController().signal, sleep: instant });
  assert.deepEqual(again.calls, ["create clip.mp4 8", "put 0+4", "put 4+4", "status 4", "put 4+4", "status 4", "put 4+4", "finish"]);
});

test("an upload resumes from the bytes the computer already has", async () => {
  const { transport, calls } = fakeTransport({ chunkBytes: 4, received: 8 });
  await runUpload(source(10), transport, { signal: new AbortController().signal, sleep: instant });
  assert.deepEqual(calls, ["create clip.mp4 10", "put 8+2", "finish"]);
});

test("a full disk stops at once and keeps how much space is left", async () => {
  const { transport, calls } = fakeTransport({ chunkBytes: 4, fatalAt: 4 });
  await assert.rejects(runUpload(source(10), transport, { signal: new AbortController().signal, sleep: instant }), (error: UploadError) => error.code === "disk_full" && error.detail.free === 10);
  assert.deepEqual(calls, ["create clip.mp4 10", "put 0+4", "put 4+4"]);
});

test("retries give up after the limit", async () => {
  const { transport } = fakeTransport({ chunkBytes: 4, failures: { 0: 10 } });
  await assert.rejects(runUpload(source(4), transport, { signal: new AbortController().signal, sleep: instant, retries: 2 }), (error: UploadError) => error.code === "failed");
});

test("cancelling aborts before the next chunk", async () => {
  const controller = new AbortController();
  const { transport, calls } = fakeTransport({ chunkBytes: 4 });
  await assert.rejects(
    runUpload(source(12), transport, { signal: controller.signal, sleep: instant, onProgress: (sent) => sent >= 4 && controller.abort() }),
    (error: UploadError) => error.code === "aborted",
  );
  assert.ok(!calls.includes("finish"));
  assert.ok(!calls.includes("put 4+4"));
});

test("HTTP statuses become upload errors and pasted screenshots get a dated name", () => {
  assert.equal(errorFromStatus(507, { free: 5 }).code, "disk_full");
  assert.equal(errorFromStatus(413, { max: 9 }).detail.max, 9);
  assert.equal(errorFromStatus(503).code, "offline");
  assert.equal(errorFromStatus(500).code, "failed");
  assert.equal(pastedName("Screenshot", "image/png", new Date(2026, 9, 7, 14, 3, 9)), "Screenshot 2026-10-07 14.03.09.png");
  assert.equal(pastedName("Screenshot", "image/jpeg", new Date(2026, 0, 2, 3, 4, 5)), "Screenshot 2026-01-02 03.04.05.jpg");
});
