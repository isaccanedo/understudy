import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  ftruncateSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  watch,
  writeFileSync,
  writeSync,
  type FSWatcher,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  areaPath,
  ARTIFACT_MAX_PAGES,
  artifactKindOf,
  DISK_HEADROOM_BYTES,
  FILE_MAX_BYTES,
  FILE_READ_MAX_BYTES,
  mimeOf,
  needsPdfConversion,
  numberedName,
  safeFileName,
  type Attachment,
  type ComputerToServer,
  type FileEntry,
  type ServerToComputer,
} from "@understudy/protocol";
import { log } from "@understudy/runtime";
import { memoryPath as pathInside } from "./memory-sync.ts";

const DEBOUNCE_MS = 1500;
const MAX_ENTRIES = 1000;

export function listFiles(root: string): FileEntry[] {
  const entries: FileEntry[] = [];
  const walk = (dir: string) => {
    let items;
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entries.length >= MAX_ENTRIES || item.name.startsWith(".")) continue;
      const full = join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) {
        try {
          const stat = statSync(full);
          entries.push({ path: relative(root, full).split(sep).join("/"), size: stat.size, updatedAt: Math.round(stat.mtimeMs) });
        } catch {}
      }
    }
  };
  walk(root);
  return entries;
}

export type FileExchange = {
  publish: () => void;
  put: (path: string, base64: string) => string | null;
  get: (requestId: string, path: string) => ComputerToServer;
  close: () => void;
};

export function startFileExchange(home: string, send: (message: ComputerToServer) => boolean): FileExchange {
  const inbox = join(home, "files", "inbox");
  const outbox = join(home, "files", "outbox");
  mkdirSync(inbox, { recursive: true });
  mkdirSync(outbox, { recursive: true });
  let timer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;

  const publish = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    send({ type: "files", files: listFiles(outbox) });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(publish, DEBOUNCE_MS);
  };

  try {
    watcher = watch(outbox, { recursive: true }, schedule);
    watcher.on("error", (error) => log("files", `watch failed: ${error.message}`));
  } catch (error) {
    log("files", `watch unavailable: ${(error as Error).message}`);
    setInterval(schedule, 10000).unref();
  }

  return {
    publish,
    put(path, base64) {
      const target = pathInside(inbox, path);
      if (!target) {
        log("files", `refused upload outside the inbox: ${JSON.stringify(path).slice(0, 120)}`);
        return null;
      }
      const data = Buffer.from(String(base64 ?? ""), "base64");
      if (data.length > FILE_MAX_BYTES) {
        log("files", `refused upload over ${FILE_MAX_BYTES} bytes: ${path}`);
        return null;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      return target;
    },
    get(requestId, path) {
      const target = pathInside(outbox, path);
      if (!target) return { type: "file_content", requestId, path, error: "path is outside the outbox" };
      try {
        const stat = statSync(target);
        if (!stat.isFile()) return { type: "file_content", requestId, path, error: "not a file" };
        if (stat.size > FILE_MAX_BYTES) return { type: "file_content", requestId, path, error: `file is larger than ${FILE_MAX_BYTES} bytes` };
        return { type: "file_content", requestId, path, base64: readFileSync(target).toString("base64") };
      } catch {
        return { type: "file_content", requestId, path, error: "no such file" };
      }
    },
    close() {
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
  };
}

const UPLOAD_ID = /^[A-Za-z0-9_-]{8,80}$/;
const STALE_UPLOAD_MS = 2 * 24 * 60 * 60 * 1000;
const THUMB_TIMEOUT_MS = 20_000;
const CONVERT_TIMEOUT_MS = 120_000;
const PAGE_KEY = /^[a-f0-9]{32}$/;

type UploadMeta = { name: string; size: number; startedAt: number };

export type UploadState = { received: number; free?: number; error?: string };

export type FileStore = {
  openUpload: (uploadId: string, name: string, size: number) => UploadState;
  writeChunk: (uploadId: string, offset: number, data: Buffer) => UploadState;
  finishUpload: (uploadId: string) => { attachment?: Attachment; error?: string };
  cancelUpload: (uploadId: string) => void;
  read: (path: string, offset: number, length: number) => { size?: number; data?: Buffer; error?: string };
  thumb: (path: string) => Promise<{ data?: Buffer; error?: string }>;
  share: (path: string) => { attachment?: Attachment; error?: string };
  resolve: (path: string) => string | null;
  render: (path: string) => Promise<{ key?: string; pages?: number; error?: string }>;
  page: (key: string, page: number) => { data?: Buffer; error?: string };
};

export function freeBytes(dir: string): number {
  try {
    const stats = statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function isInside(child: string, parent: string) {
  return child === parent || child.startsWith(parent + sep);
}

function realOrNull(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function hiddenSegment(path: string) {
  return path.split(sep).some((part) => part.startsWith("."));
}

function diskFull(error: unknown) {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOSPC" || code === "EDQUOT";
}

export function uniqueTarget(dir: string, name: string): string {
  const safe = safeFileName(name);
  for (let n = 1; n < 10_000; n++) {
    const candidate = join(dir, numberedName(safe, n));
    if (!existsSync(candidate)) return candidate;
  }
  return join(dir, `${Date.now()}-${safe}`);
}

function runQuiet(command: string, args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      done(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
  });
}

export function createFileStore(home: string, options: { free?: (dir: string) => number; now?: () => number } = {}): FileStore {
  const filesRoot = join(home, "files");
  const inbox = join(filesRoot, "inbox");
  const outbox = join(filesRoot, "outbox");
  const uploads = join(home, ".understudy", "uploads");
  const thumbs = join(home, ".understudy", "thumbs");
  const pagesRoot = join(home, ".understudy", "artifact-pages");
  const free = options.free ?? freeBytes;
  const now = options.now ?? Date.now;
  for (const dir of [inbox, outbox, uploads, thumbs, pagesRoot]) mkdirSync(dir, { recursive: true });

  for (const name of readdirSync(uploads)) {
    try {
      if (now() - statSync(join(uploads, name)).mtimeMs > STALE_UPLOAD_MS) rmSync(join(uploads, name), { force: true });
    } catch {}
  }

  const partOf = (uploadId: string) => join(uploads, `${uploadId}.part`);
  const metaOf = (uploadId: string) => join(uploads, `${uploadId}.json`);
  const loadMeta = (uploadId: string): UploadMeta | null => {
    if (!UPLOAD_ID.test(uploadId)) return null;
    try {
      return JSON.parse(readFileSync(metaOf(uploadId), "utf8")) as UploadMeta;
    } catch {
      return null;
    }
  };
  const received = (uploadId: string) => {
    try {
      return statSync(partOf(uploadId)).size;
    } catch {
      return 0;
    }
  };

  const resolveArea = (path: string): string | null => {
    const parsed = areaPath(path);
    if (!parsed) return null;
    const root = parsed.area === "inbox" ? inbox : outbox;
    const realRoot = realOrNull(root);
    const real = realOrNull(join(root, ...parsed.rest.split("/")));
    if (!realRoot || !real || !isInside(real, realRoot) || real === realRoot) return null;
    return real;
  };

  const attachmentFor = (target: string): Attachment => {
    const realFiles = realOrNull(filesRoot) ?? filesRoot;
    const name = basename(target);
    return { path: relative(realFiles, target).split(sep).join("/"), name, size: statSync(target).size, mime: mimeOf(name) };
  };

  return {
    resolve: resolveArea,

    openUpload(uploadId, name, size) {
      if (!UPLOAD_ID.test(uploadId)) return { received: 0, error: "bad_upload" };
      const existing = loadMeta(uploadId);
      if (existing) return { received: received(uploadId) };
      const available = free(uploads);
      if (available < size + DISK_HEADROOM_BYTES) return { received: 0, free: available, error: "disk_full" };
      try {
        writeFileSync(metaOf(uploadId), JSON.stringify({ name: safeFileName(name), size, startedAt: now() } satisfies UploadMeta));
        writeFileSync(partOf(uploadId), "");
      } catch (error) {
        return { received: 0, free: available, error: diskFull(error) ? "disk_full" : "failed" };
      }
      return { received: 0 };
    },

    writeChunk(uploadId, offset, data) {
      const meta = loadMeta(uploadId);
      if (!meta) return { received: 0, error: "unknown_upload" };
      const current = received(uploadId);
      if (offset > current) return { received: current, error: "gap" };
      if (offset + data.length > meta.size) return { received: current, error: "too_large" };
      let fd: number | null = null;
      try {
        fd = openSync(partOf(uploadId), "r+");
        let written = 0;
        while (written < data.length) written += writeSync(fd, data, written, data.length - written, offset + written);
        ftruncateSync(fd, offset + data.length);
      } catch (error) {
        if (diskFull(error)) return { received: Math.min(current, offset), free: free(uploads), error: "disk_full" };
        return { received: current, error: "failed" };
      } finally {
        if (fd !== null) closeSync(fd);
      }
      return { received: offset + data.length };
    },

    finishUpload(uploadId) {
      const meta = loadMeta(uploadId);
      if (!meta) return { error: "unknown_upload" };
      if (received(uploadId) !== meta.size) return { error: "incomplete" };
      const target = uniqueTarget(inbox, meta.name);
      try {
        renameSync(partOf(uploadId), target);
        rmSync(metaOf(uploadId), { force: true });
      } catch {
        return { error: "failed" };
      }
      log("files", `owner uploaded ${basename(target)} (${meta.size} bytes)`);
      return { attachment: attachmentFor(realOrNull(target) ?? target) };
    },

    cancelUpload(uploadId) {
      if (!UPLOAD_ID.test(uploadId)) return;
      rmSync(partOf(uploadId), { force: true });
      rmSync(metaOf(uploadId), { force: true });
    },

    read(path, offset, length) {
      const target = resolveArea(path);
      if (!target) return { error: "not_found" };
      let fd: number | null = null;
      try {
        const stat = statSync(target);
        if (!stat.isFile()) return { error: "not_found" };
        const size = stat.size;
        const count = Math.max(0, Math.min(length, FILE_READ_MAX_BYTES, size - offset));
        if (count === 0) return { size, data: Buffer.alloc(0) };
        const data = Buffer.alloc(count);
        fd = openSync(target, "r");
        let read = 0;
        while (read < count) {
          const n = readSync(fd, data, read, count - read, offset + read);
          if (n === 0) break;
          read += n;
        }
        return { size, data: data.subarray(0, read) };
      } catch {
        return { error: "not_found" };
      } finally {
        if (fd !== null) closeSync(fd);
      }
    },

    async thumb(path) {
      const target = resolveArea(path);
      if (!target) return { error: "not_found" };
      const mime = mimeOf(target);
      if (mime !== "application/pdf" && !mime.startsWith("video/")) return { error: "no_preview" };
      const stat = statSync(target);
      const key = createHash("sha256").update(`${target}:${stat.size}:${stat.mtimeMs}`).digest("hex").slice(0, 32);
      const out = join(thumbs, `${key}.jpg`);
      if (!existsSync(out)) {
        const ok =
          mime === "application/pdf"
            ? await runQuiet("pdftoppm", ["-jpeg", "-f", "1", "-l", "1", "-scale-to", "720", "-singlefile", target, out.slice(0, -4)], THUMB_TIMEOUT_MS)
            : await runQuiet("ffmpeg", ["-loglevel", "error", "-y", "-ss", "0.5", "-i", target, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "5", out], THUMB_TIMEOUT_MS);
        if (!ok || !existsSync(out)) return { error: "no_preview" };
      }
      return { data: readFileSync(out) };
    },

    async render(path) {
      const target = resolveArea(path);
      if (!target || artifactKindOf(target) !== "pages") return { error: "not_found" };
      const stat = statSync(target);
      const key = createHash("sha256").update(`${target}:${stat.size}:${stat.mtimeMs}`).digest("hex").slice(0, 32);
      const dir = join(pagesRoot, key);
      const count = () => {
        try {
          return readdirSync(dir).filter((name) => /^page-\d+\.jpg$/.test(name)).length;
        } catch {
          return 0;
        }
      };
      if (existsSync(join(dir, "done")) && count() > 0) return { key, pages: count() };
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      let pdf = target;
      if (needsPdfConversion(target)) {
        const profile = join(dir, "profile");
        const ok = await runQuiet("soffice", [`-env:UserInstallation=file://${profile}`, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, target], CONVERT_TIMEOUT_MS);
        rmSync(profile, { recursive: true, force: true });
        pdf = readdirSync(dir).map((name) => join(dir, name)).find((name) => name.endsWith(".pdf")) ?? "";
        if (!ok || !pdf) return { error: "no_preview" };
      }
      const ok = await runQuiet("pdftoppm", ["-jpeg", "-jpegopt", "quality=85", "-scale-to", "1600", "-f", "1", "-l", String(ARTIFACT_MAX_PAGES), pdf, join(dir, "raw")], CONVERT_TIMEOUT_MS);
      const raws = readdirSync(dir).filter((name) => /^raw-\d+\.jpg$/.test(name)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
      if (!ok || raws.length === 0) return { error: "no_preview" };
      raws.forEach((name, index) => renameSync(join(dir, name), join(dir, `page-${index + 1}.jpg`)));
      if (pdf !== target) rmSync(pdf, { force: true });
      writeFileSync(join(dir, "done"), "");
      log("files", `rendered ${basename(target)} into ${raws.length} pages`);
      return { key, pages: raws.length };
    },

    page(key, page) {
      if (!PAGE_KEY.test(key) || !Number.isInteger(page) || page < 1) return { error: "not_found" };
      try {
        return { data: readFileSync(join(pagesRoot, key, `page-${page}.jpg`)) };
      } catch {
        return { error: "not_found" };
      }
    },

    share(path) {
      const raw = String(path ?? "").trim();
      if (!raw || raw.includes("\0")) return { error: "no such file" };
      const expanded = raw === "~" ? home : raw.startsWith("~/") ? join(home, raw.slice(2)) : raw;
      const absolute = isAbsolute(expanded) ? expanded : resolve(filesRoot, expanded);
      const realHome = realOrNull(home) ?? home;
      const real = realOrNull(absolute);
      if (!real) return { error: `no such file: ${raw}` };
      if (!isInside(real, realHome) || hiddenSegment(relative(realHome, real))) return { error: "only files in your home folder can be shared, outside hidden folders" };
      let stat;
      try {
        stat = statSync(real);
      } catch {
        return { error: `no such file: ${raw}` };
      }
      if (!stat.isFile()) return { error: "that is a folder; zip it first and share the zip" };
      const realInbox = realOrNull(inbox) ?? inbox;
      const realOutbox = realOrNull(outbox) ?? outbox;
      if (isInside(real, realInbox) || isInside(real, realOutbox)) return { attachment: attachmentFor(real) };
      const target = uniqueTarget(outbox, basename(real));
      try {
        try {
          linkSync(real, target);
        } catch {
          copyFileSync(real, target);
        }
      } catch (error) {
        return { error: diskFull(error) ? "the disk is full" : "could not copy the file into ~/files/outbox" };
      }
      return { attachment: attachmentFor(realOrNull(target) ?? target) };
    },
  };
}

export async function answerFileMessage(store: FileStore, message: ServerToComputer): Promise<ComputerToServer | null> {
  switch (message.type) {
    case "upload_open":
      return { type: "upload_state", requestId: message.requestId, uploadId: message.uploadId, ...store.openUpload(message.uploadId, message.name, message.size) };
    case "upload_chunk":
      return { type: "upload_state", requestId: message.requestId, uploadId: message.uploadId, ...store.writeChunk(message.uploadId, message.offset, Buffer.from(message.base64, "base64")) };
    case "upload_finish":
      return { type: "upload_done", requestId: message.requestId, uploadId: message.uploadId, ...store.finishUpload(message.uploadId) };
    case "upload_cancel":
      store.cancelUpload(message.uploadId);
      return null;
    case "file_read": {
      const result = store.read(message.path, message.offset, message.length);
      return { type: "file_chunk", requestId: message.requestId, ...(result.size !== undefined ? { size: result.size } : {}), ...(result.data ? { base64: result.data.toString("base64") } : {}), ...(result.error ? { error: result.error } : {}) };
    }
    case "file_thumb": {
      const result = await store.thumb(message.path);
      return { type: "file_chunk", requestId: message.requestId, ...(result.data ? { size: result.data.length, base64: result.data.toString("base64") } : {}), ...(result.error ? { error: result.error } : {}) };
    }
    case "file_share":
      return { type: "file_shared", requestId: message.requestId, ...store.share(message.path) };
    case "artifact_render":
      return { type: "artifact_rendered", requestId: message.requestId, ...(await store.render(message.path)) };
    case "artifact_page": {
      const result = store.page(message.key, message.page);
      return { type: "file_chunk", requestId: message.requestId, ...(result.data ? { size: result.data.length, base64: result.data.toString("base64") } : {}), ...(result.error ? { error: result.error } : {}) };
    }
    default:
      return null;
  }
}
