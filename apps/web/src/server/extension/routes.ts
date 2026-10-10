import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import type { Hub } from "../hub";
import { RateLimiter } from "../rate-limit";
import { clientIp } from "../webhook";
import { audioMediaType, BrowserRecordings, MAX_CLIP_BYTES } from "./browser-recordings";
import { extensionFolderName } from "@/lib/extension-folder";
import { extensionPackage } from "./package";
import { authenticateExtension, redeemPairCode, revokeExtensionToken, type ExtensionUser } from "./pairing";
import { transcriberFromEnv } from "./transcriber";

export const EXTENSION_PREFIX = "/api/extension/";
const JSON_LIMIT = 512 * 1024;
const limiter = new RateLimiter();

export function isExtensionRoute(pathname: string) {
  return pathname.startsWith(EXTENSION_PREFIX);
}

export function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Started-At",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function reply(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(req.headers.origin) });
  res.end(JSON.stringify(body));
}

async function readRaw(req: IncomingMessage, limit: number) {
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
  const raw = await readRaw(req, JSON_LIMIT);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.toString("utf8") || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function ownedAgents(userId: string) {
  return getDb()
    .select({ id: schema.agents.id, name: schema.agents.name, role: schema.agents.role })
    .from(schema.agents)
    .where(eq(schema.agents.ownerId, userId))
    .orderBy(schema.agents.createdAt);
}

export function createExtensionRoutes(hub: Hub, options: { recordings?: BrowserRecordings } = {}) {
  const recordings = options.recordings ?? new BrowserRecordings(hub, () => transcriberFromEnv());
  if (!options.recordings) {
    setInterval(() => void recordings.expireAbandoned().catch((error) => console.error("browser_recordings_expire_error", error)), 15 * 60 * 1000).unref();
  }

  async function authed(req: IncomingMessage, res: ServerResponse): Promise<ExtensionUser | null> {
    const user = await authenticateExtension(req.headers.authorization);
    if (!user) {
      reply(req, res, 401, { error: "unauthorized" });
      return null;
    }
    if (!limiter.allow(`ext:${user.tokenId}`, 10, 120)) {
      reply(req, res, 429, { error: "too_many_requests" });
      return null;
    }
    return user;
  }

  async function handle(req: IncomingMessage, res: ServerResponse, pathname: string) {
    const method = req.method ?? "GET";
    if (method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req.headers.origin));
      res.end();
      return;
    }
    const parts = pathname.slice(EXTENSION_PREFIX.length).split("/").filter(Boolean);

    if (parts[0] === "package.zip" && parts.length === 1 && (method === "GET" || method === "HEAD")) {
      const data = await extensionPackage();
      if (!data) return reply(req, res, 404, { error: "extension_not_built" });
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": data.length,
        "Content-Disposition": `attachment; filename="${extensionFolderName(env.productName)}.zip"`,
        "Cache-Control": "no-store",
      });
      res.end(method === "HEAD" ? undefined : data);
      return;
    }

    if (parts[0] === "pair" && parts.length === 1 && method === "POST") {
      if (!limiter.allow(`ext-pair:${clientIp(req)}`, 0.2, 10)) return reply(req, res, 429, { error: "too_many_requests" });
      const body = await readJson(req);
      const paired = body ? await redeemPairCode(String(body.code ?? ""), String(body.label ?? "")) : null;
      if (!paired) return reply(req, res, 400, { error: "invalid_code" });
      return reply(req, res, 200, { token: paired.token, user: { name: paired.user.name, email: paired.user.email }, productName: env.productName });
    }

    if (parts[0] === "me" && parts.length === 1) {
      const user = await authed(req, res);
      if (!user) return;
      if (method === "DELETE") {
        await revokeExtensionToken(user.id, user.tokenId);
        return reply(req, res, 200, { ok: true });
      }
      if (method !== "GET") return reply(req, res, 405, { error: "method_not_allowed" });
      const agents = await ownedAgents(user.id);
      return reply(req, res, 200, {
        user: { name: user.name, email: user.email },
        productName: env.productName,
        agents: agents.map((agent) => ({ ...agent, online: hub.isOnline(agent.id), avatarUrl: `${env.publicUrl}/api/agents/${agent.id}/avatar.png` })),
      });
    }

    if (parts[0] !== "recordings") return reply(req, res, 404, { error: "not_found" });
    const user = await authed(req, res);
    if (!user) return;

    if (parts.length === 1 && method === "POST") {
      const body = await readJson(req);
      if (!body) return reply(req, res, 400, { error: "invalid_body" });
      const outcome = await recordings.start(user.id, String(body.agentId ?? ""));
      return outcome.ok ? reply(req, res, 201, outcome.value) : reply(req, res, outcome.status, { error: outcome.error });
    }

    const recordingId = parts[1];
    if (!recordingId || !/^rec_[A-Za-z0-9_-]{8,40}$/.test(recordingId)) return reply(req, res, 404, { error: "not_found" });
    const action = parts[2];

    if (!action && method === "GET") {
      const status = await recordings.status(user.id, recordingId);
      return status ? reply(req, res, 200, status) : reply(req, res, 404, { error: "recording_not_found" });
    }
    if (!action && method === "DELETE") {
      const outcome = await recordings.discard(user.id, recordingId);
      return outcome.ok ? reply(req, res, 200, { ok: true }) : reply(req, res, outcome.status, { error: outcome.error });
    }
    if (action === "events" && method === "POST") {
      const body = await readJson(req);
      if (!body) return reply(req, res, 413, { error: "invalid_body" });
      const outcome = await recordings.addEvents(user.id, recordingId, body.events);
      return outcome.ok ? reply(req, res, 200, outcome.value) : reply(req, res, outcome.status, { error: outcome.error });
    }
    if (action === "audio" && method === "POST") {
      const mediaType = audioMediaType(req.headers["content-type"]);
      if (!mediaType) return reply(req, res, 415, { error: "unsupported_audio" });
      const audio = await readRaw(req, MAX_CLIP_BYTES);
      if (!audio) return reply(req, res, 413, { error: "audio_too_large" });
      const outcome = await recordings.addAudio(user.id, recordingId, Number(req.headers["x-started-at"]), mediaType, audio);
      return outcome.ok ? reply(req, res, 201, outcome.value) : reply(req, res, outcome.status, { error: outcome.error });
    }
    if (action === "stop" && method === "POST") {
      const outcome = await recordings.stop(user.id, recordingId);
      return outcome.ok ? reply(req, res, 202, { status: "processing" }) : reply(req, res, outcome.status, { error: outcome.error });
    }
    return reply(req, res, 404, { error: "not_found" });
  }

  return { handle, recordings };
}
