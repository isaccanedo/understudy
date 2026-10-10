import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import next from "next";
import { WebSocketServer, type WebSocket } from "ws";
import { panelFramePolicy, PATHS } from "@understudy/protocol";
import { agentAccess } from "@/lib/access";
import { sessionFromHeaders } from "@/lib/auth";
import { sameSecret } from "@/lib/secret-compare";
import { getDb, getPool, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { authenticateComputer, handleGatekeeper } from "@/server/gatekeeper";
import { createHub } from "@/server/hub";
import { ownedRoom } from "@/server/hub/rooms";
import { ROOM_SOCKET } from "@/lib/rooms";
import { handleWebhook } from "@/server/webhook";
import { handleInboundEmail } from "@/server/inbound-email/handler";
import { handleFigureRoute, isFigureRoute } from "@/server/figure-png";
import { handleSlack, isSlackRoute } from "@/server/slack-inbound";
import { createExtensionRoutes, isExtensionRoute } from "@/server/extension/routes";
import { ARTIFACT_CONTENT_PREFIX, handleArtifactContent, isArtifactContentRoute } from "@/server/artifacts/routes";
import { createFileRoutes, isFileRoute } from "@/server/files/routes";
import { startBriefings } from "@/server/briefing";
import { originAllowed } from "@/server/origin";
import { Scheduler } from "@/server/scheduler";

const dir = process.env.UNDERSTUDY_APP_DIR ?? process.cwd();
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME_BIND ?? "0.0.0.0";

function loadStandaloneConfig() {
  const file = path.join(dir, ".next", "required-server-files.json");
  if (dev || process.env.__NEXT_PRIVATE_STANDALONE_CONFIG || !existsSync(file)) return;
  const required = JSON.parse(readFileSync(file, "utf8"));
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(required.config);
}

function headersOf(req: IncomingMessage) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

function bearer(req: IncomingMessage) {
  return req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
}

async function main() {
  const migrationsFolder = process.env.UNDERSTUDY_MIGRATIONS_DIR ?? path.join(dir, "drizzle");
  await migrate(getDb(), { migrationsFolder });
  console.log(JSON.stringify({ event: "migrations_done", migrationsFolder }));

  loadStandaloneConfig();
  const app = next({ dev, dir, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const nextUpgrade = app.getUpgradeHandler();

  const hub = createHub();
  const scheduler = new Scheduler(hub);
  scheduler.start();
  hub.watcher.start();
  hub.idle.start();
  const briefings = startBriefings();
  const extension = createExtensionRoutes(hub);
  const fileRoutes = createFileRoutes(hub);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/live") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    if (url.pathname === "/api/health") {
      getPool()
        .query("select 1")
        .then(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        })
        .catch((error) => {
          console.error("health_db_error", error);
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false }));
        });
      return;
    }
    if (url.pathname.startsWith("/api/hooks/")) {
      handleWebhook(hub, req, res, url.pathname).catch((error) => {
        console.error("webhook_error", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
      return;
    }
    if (isExtensionRoute(url.pathname)) {
      extension.handle(req, res, url.pathname).catch((error) => {
        console.error("extension_route_error", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
      return;
    }
    if (isArtifactContentRoute(url.pathname)) {
      handleArtifactContent(req, res, url).catch((error) => {
        console.error("artifact_route_error", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        } else res.destroy();
      });
      return;
    }
    if (isFileRoute(url.pathname)) {
      fileRoutes.handle(req, res, url).catch((error) => {
        console.error("file_route_error", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        } else res.destroy();
      });
      return;
    }
    if (isSlackRoute(url.pathname)) {
      handleSlack(hub, req, res, url.pathname).catch((error) => {
        console.error("slack_inbound_error", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
      return;
    }
    if (isFigureRoute(url.pathname)) {
      handleFigureRoute(req, res, url.pathname).catch((error) => {
        console.error("figure_png_error", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
      return;
    }
    if (url.pathname === "/api/inbound/email") {
      handleInboundEmail(hub, req, res).catch((error) => {
        console.error("inbound_email_error", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
      return;
    }
    if (url.pathname === PATHS.gatekeeperMcp) {
      handleGatekeeper(hub, req, res).catch((error) => {
        console.error("gatekeeper_error", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
      return;
    }
    res.setHeader("Content-Security-Policy", panelFramePolicy(`${env.artifactOrigin ?? env.publicUrl}${ARTIFACT_CONTENT_PREFIX}`));
    handle(req, res);
  });

  server.requestTimeout = 60 * 60 * 1000;
  server.headersTimeout = 60 * 60 * 1000;
  server.keepAliveTimeout = 65 * 1000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

  function accept(req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer, onOpen: (ws: WebSocket) => void) {
    wss.handleUpgrade(req, socket, head, (ws) => onOpen(ws));
  }

  function refuse(socket: import("node:stream").Duplex, status: number, text: string) {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === PATHS.hostSocket) {
        const expected = env.hostToken;
        if (!expected || !sameSecret(bearer(req) ?? "", expected)) return refuse(socket, 401, "Unauthorized");
        return accept(req, socket, head, (ws) => hub.attachHost(ws));
      }
      if (url.pathname === PATHS.computerSocket) {
        const agent = await authenticateComputer(req.headers.authorization);
        const requested = url.searchParams.get("agent");
        if (!agent || (requested && requested !== agent.id)) return refuse(socket, 401, "Unauthorized");
        return accept(req, socket, head, (ws) => {
          hub.attachComputer(ws, agent.id).catch((error) => console.error("attach_computer_error", error));
        });
      }
      if (url.pathname === PATHS.viewerSocket) {
        if (!originAllowed(req.headers.origin, env.publicUrl)) return refuse(socket, 403, "Forbidden");
        const user = await sessionFromHeaders(headersOf(req));
        const agentId = url.searchParams.get("agent");
        if (!user || user.status !== "approved" || user.mustChangePassword || !agentId) return refuse(socket, 401, "Unauthorized");
        const access = await agentAccess(user.id, agentId);
        if (!access) return refuse(socket, 403, "Forbidden");
        return accept(req, socket, head, (ws) => {
          hub.attachViewer(ws, agentId, user.id, access).catch((error) => console.error("attach_viewer_error", error));
        });
      }
      if (url.pathname === ROOM_SOCKET) {
        if (!originAllowed(req.headers.origin, env.publicUrl)) return refuse(socket, 403, "Forbidden");
        const user = await sessionFromHeaders(headersOf(req));
        const roomId = url.searchParams.get("room");
        if (!user || user.status !== "approved" || user.mustChangePassword || !roomId) return refuse(socket, 401, "Unauthorized");
        if (!(await ownedRoom(roomId, user.id))) return refuse(socket, 403, "Forbidden");
        return accept(req, socket, head, (ws) => hub.attachRoomViewer(ws, roomId, user.id));
      }
      return nextUpgrade(req, socket, head);
    } catch (error) {
      console.error("upgrade_error", error);
      refuse(socket, 500, "Internal Server Error");
    }
  });

  server.listen(port, hostname, () => {
    console.log(JSON.stringify({ event: "listening", url: env.publicUrl, port, dev }));
  });

  const shutdown = () => {
    scheduler.stop();
    briefings?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
