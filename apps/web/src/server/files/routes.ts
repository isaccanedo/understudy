import type { IncomingMessage, ServerResponse } from "node:http";
import {
  areaPath,
  FILE_READ_MAX_BYTES,
  inlineContentType,
  parseRange,
  UPLOAD_CHUNK_BYTES,
  type ServerToComputer,
} from "@understudy/protocol";
import { agentAccess, type Access } from "@/lib/access";
import { sessionFromHeaders } from "@/lib/auth";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import type { ComputerReply, Hub } from "../hub";
import { originAllowed } from "../origin";
import { RateLimiter } from "../rate-limit";
import { attachedToChat, canRead, canUpload } from "./access";

export const FILES_PREFIX = "/api/files/";
const JSON_LIMIT = 16 * 1024;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const limiter = new RateLimiter();

export type FileRoute =
  | { kind: "create"; agentId: string }
  | { kind: "status"; agentId: string; uploadId: string }
  | { kind: "chunk"; agentId: string; uploadId: string }
  | { kind: "finish"; agentId: string; uploadId: string }
  | { kind: "cancel"; agentId: string; uploadId: string }
  | { kind: "raw"; agentId: string }
  | { kind: "thumb"; agentId: string };

export function isFileRoute(pathname: string) {
  return pathname.startsWith(FILES_PREFIX);
}

export function matchFileRoute(method: string, pathname: string): FileRoute | null {
  if (!isFileRoute(pathname)) return null;
  const parts = pathname.slice(FILES_PREFIX.length).split("/");
  const [agentId, section, uploadId, action, ...extra] = parts;
  if (!agentId || !ID.test(agentId) || extra.length) return null;
  if (section === "raw" && !uploadId && (method === "GET" || method === "HEAD")) return { kind: "raw", agentId };
  if (section === "thumb" && !uploadId && method === "GET") return { kind: "thumb", agentId };
  if (section !== "uploads") return null;
  if (!uploadId) return method === "POST" ? { kind: "create", agentId } : null;
  if (!ID.test(uploadId)) return null;
  if (action === "finish") return method === "POST" ? { kind: "finish", agentId, uploadId } : null;
  if (action) return null;
  if (method === "GET") return { kind: "status", agentId, uploadId };
  if (method === "PUT") return { kind: "chunk", agentId, uploadId };
  if (method === "DELETE") return { kind: "cancel", agentId, uploadId };
  return null;
}

export function contentDisposition(name: string, inline: boolean) {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function fileHeaders(name: string, download: boolean): Record<string, string> {
  const inlineType = inlineContentType(name);
  const inline = Boolean(inlineType) && !download;
  const pdf = inlineType === "application/pdf";
  return {
    "Content-Type": inlineType ?? "application/octet-stream",
    "Content-Disposition": contentDisposition(name, inline),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": pdf ? "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" : "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
  };
}

export function uploadErrorStatus(error: string | undefined) {
  if (!error) return 200;
  if (error === "disk_full") return 507;
  if (error === "too_large") return 413;
  if (error === "gap") return 409;
  if (error === "unknown_upload" || error === "not_found") return 404;
  if (error === "offline") return 503;
  if (error === "timeout") return 504;
  return 500;
}

function reply(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function headersOf(req: IncomingMessage) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const raw = await readBody(req, JSON_LIMIT);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.toString("utf8") || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function failed(result: ComputerReply | { type: "failed"; error: string }): string | undefined {
  if (result.type === "failed") return result.error;
  return "error" in result ? result.error : undefined;
}

export function createFileRoutes(hub: Hub) {
  const ask = <T extends ComputerReply>(agentId: string, message: Extract<ServerToComputer, { requestId: string }>, timeoutMs?: number) =>
    hub.askComputer<T>(agentId, message, timeoutMs);

  async function caller(req: IncomingMessage, agentId: string): Promise<{ userId: string; name: string; access: Access } | null> {
    const user = await sessionFromHeaders(headersOf(req));
    if (!user || user.status !== "approved" || user.mustChangePassword) return null;
    const access = await agentAccess(user.id, agentId);
    return access ? { userId: user.id, name: user.name, access } : null;
  }

  async function stream(req: IncomingMessage, res: ServerResponse, agentId: string, path: string, download: boolean) {
    const head = await ask<Extract<ComputerReply, { type: "file_chunk" }>>(agentId, { type: "file_read", requestId: newId("fr"), path, offset: 0, length: 0 }, 30_000);
    const headError = failed(head);
    if (headError || head.type !== "file_chunk" || head.size === undefined) return reply(res, uploadErrorStatus(headError ?? "not_found"), { error: headError ?? "not_found" });
    const size = head.size;
    const name = areaPath(path)?.rest.split("/").pop() ?? "file";
    const headers = fileHeaders(name, download);
    const range = parseRange(req.headers.range, size);
    if (range === "invalid") {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
      return res.end();
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    const length = size === 0 ? 0 : end - start + 1;
    res.writeHead(range ? 206 : 200, {
      ...headers,
      "Content-Length": String(length),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === "HEAD" || length === 0) return res.end();
    let closed = false;
    res.on("close", () => {
      closed = true;
    });
    let offset = start;
    while (offset <= end && !closed) {
      const want = Math.min(FILE_READ_MAX_BYTES, end - offset + 1);
      const chunk = await ask<Extract<ComputerReply, { type: "file_chunk" }>>(agentId, { type: "file_read", requestId: newId("fr"), path, offset, length: want }, 60_000);
      if (failed(chunk) || chunk.type !== "file_chunk" || !chunk.base64) {
        res.destroy();
        return;
      }
      const data = Buffer.from(chunk.base64, "base64");
      if (!data.length) break;
      offset += data.length;
      if (!res.write(data)) await new Promise<void>((resolve) => res.once("drain", () => resolve()).once("close", () => resolve()));
    }
    res.end();
  }

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    const method = req.method ?? "GET";
    const route = matchFileRoute(method, url.pathname);
    if (!route) return reply(res, 404, { error: "not_found" });
    const reading = route.kind === "raw" || route.kind === "thumb" || route.kind === "status";
    if (!reading && (!req.headers.origin || !originAllowed(req.headers.origin, env.publicUrl))) return reply(res, 403, { error: "forbidden" });
    const who = await caller(req, route.agentId);
    if (!who) return reply(res, 404, { error: "not_found" });
    const { agentId } = route;

    if (route.kind === "raw" || route.kind === "thumb") {
      const path = url.searchParams.get("path") ?? "";
      if (!areaPath(path)) return reply(res, 400, { error: "bad_path" });
      const attached = who.access === "owner" ? false : await attachedToChat(agentId, path);
      if (!canRead(who.access, path, attached)) return reply(res, 404, { error: "not_found" });
      if (!limiter.allow(`read:${who.userId}`, 40, 400)) return reply(res, 429, { error: "too_many_requests" });
      if (route.kind === "raw") return stream(req, res, agentId, path, url.searchParams.get("download") === "1");
      const thumb = await ask<Extract<ComputerReply, { type: "file_chunk" }>>(agentId, { type: "file_thumb", requestId: newId("th"), path }, 45_000);
      const error = failed(thumb);
      if (error || thumb.type !== "file_chunk" || !thumb.base64) return reply(res, error === "offline" ? 503 : 404, { error: error ?? "no_preview" });
      const data = Buffer.from(thumb.base64, "base64");
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=3600",
      });
      return res.end(data);
    }

    if (!canUpload(who.access)) return reply(res, 404, { error: "not_found" });

    if (route.kind === "create") {
      if (!limiter.allow(`upload:${who.userId}`, 2, 60)) return reply(res, 429, { error: "too_many_requests" });
      const body = await readJson(req);
      const name = typeof body?.name === "string" ? body.name : "";
      const size = Number(body?.size);
      if (!name || !Number.isInteger(size) || size < 0) return reply(res, 400, { error: "bad_request" });
      const max = env.uploadMaxBytes;
      if (size > max) return reply(res, 413, { error: "too_large", max });
      if (!hub.isOnline(agentId)) return reply(res, 503, { error: "offline" });
      const upload = hub.uploads.create(agentId, who.userId, name, size);
      const state = await ask<Extract<ComputerReply, { type: "upload_state" }>>(agentId, { type: "upload_open", requestId: newId("uo"), uploadId: upload.id, name: upload.name, size });
      const error = failed(state);
      if (error || state.type !== "upload_state") {
        hub.uploads.remove(upload.id);
        return reply(res, uploadErrorStatus(error), { error, ...(state.type === "upload_state" && state.free !== undefined ? { free: state.free } : {}) });
      }
      return reply(res, 200, { uploadId: upload.id, name: upload.name, chunkBytes: UPLOAD_CHUNK_BYTES, received: state.received, max });
    }

    const upload = hub.uploads.get(route.uploadId, agentId, who.userId);
    if (!upload) return reply(res, 404, { error: "unknown_upload" });

    if (route.kind === "cancel") {
      hub.uploads.remove(upload.id);
      hub.sendToComputer(agentId, { type: "upload_cancel", uploadId: upload.id });
      return reply(res, 200, { ok: true });
    }

    if (route.kind === "status") {
      if (upload.attachment) return reply(res, 200, { received: upload.size, attachment: upload.attachment });
      const state = await ask<Extract<ComputerReply, { type: "upload_state" }>>(agentId, { type: "upload_open", requestId: newId("uo"), uploadId: upload.id, name: upload.name, size: upload.size });
      const error = failed(state);
      if (error || state.type !== "upload_state") return reply(res, uploadErrorStatus(error), { error });
      return reply(res, 200, { received: state.received });
    }

    if (route.kind === "chunk") {
      const offset = Number(url.searchParams.get("offset"));
      if (!Number.isInteger(offset) || offset < 0) return reply(res, 400, { error: "bad_offset" });
      const data = await readBody(req, UPLOAD_CHUNK_BYTES);
      if (!data) return reply(res, 413, { error: "chunk_too_large" });
      if (offset + data.length > upload.size) return reply(res, 413, { error: "too_large" });
      const state = await ask<Extract<ComputerReply, { type: "upload_state" }>>(agentId, { type: "upload_chunk", requestId: newId("uc"), uploadId: upload.id, offset, base64: data.toString("base64") });
      const error = failed(state);
      if (error || state.type !== "upload_state") {
        return reply(res, uploadErrorStatus(error), { error, ...(state.type === "upload_state" ? { received: state.received, ...(state.free !== undefined ? { free: state.free } : {}) } : {}) });
      }
      return reply(res, 200, { received: state.received });
    }

    const done = await ask<Extract<ComputerReply, { type: "upload_done" }>>(agentId, { type: "upload_finish", requestId: newId("uf"), uploadId: upload.id }, 120_000);
    const error = failed(done);
    if (error || done.type !== "upload_done" || !done.attachment) return reply(res, error === "incomplete" ? 409 : uploadErrorStatus(error ?? "failed"), { error: error ?? "failed" });
    hub.uploads.finish(upload.id, done.attachment);
    return reply(res, 200, { uploadId: upload.id, attachment: done.attachment });
  }

  return {
    handle(req: IncomingMessage, res: ServerResponse, url: URL) {
      return handle(req, res, url);
    },
  };
}
