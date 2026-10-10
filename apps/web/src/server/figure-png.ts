import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { figure } from "@understudy/characters";
import { getDb, schema } from "@/lib/db";
import { cleanLook, DEFAULT_LOOK, type Look } from "@/lib/look";

const BACKGROUND = "#07080a";
const cache = new Map<string, Buffer>();
let ready: Promise<void> | null = null;

function wasmPath() {
  const bundled = join(dirname(process.argv[1] ?? "."), "resvg.wasm");
  if (existsSync(bundled)) return bundled;
  return createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm");
}

function init() {
  ready ??= readFile(wasmPath()).then((bytes) => initWasm(bytes));
  return ready;
}

export function figureSvg(look: Look, options: { padding?: number; background?: string | null } = {}) {
  const padding = options.padding ?? 16;
  const clean = cleanLook(look);
  const inner = figure({ shape: clean.body, color: clean.color, face: clean.eyes, acc: clean.acc, accColor: clean.accColor }, "p").replace("<svg ", `<svg x="${padding}" y="${padding}" width="${200 - padding * 2}" height="${200 - padding * 2}" `);
  const background = options.background === undefined ? BACKGROUND : options.background;
  return `<svg viewBox="0 0 200 200" width="200" height="200" xmlns="http://www.w3.org/2000/svg">${background ? `<rect width="200" height="200" fill="${background}"/>` : ""}${inner}</svg>`;
}

export async function figurePng(look: Look, size: number, options: { padding?: number; background?: string | null } = {}) {
  const key = JSON.stringify([cleanLook(look), size, options]);
  const hit = cache.get(key);
  if (hit) return hit;
  await init();
  const png = Buffer.from(new Resvg(figureSvg(look, options), { fitTo: { mode: "width", value: size } }).render().asPng());
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  cache.set(key, png);
  return png;
}

const ICONS: Record<string, { size: number; padding: number }> = {
  "/icons/icon-192.png": { size: 192, padding: 14 },
  "/icons/icon-512.png": { size: 512, padding: 14 },
  "/icons/maskable-512.png": { size: 512, padding: 40 },
  "/icons/apple-touch-icon.png": { size: 180, padding: 22 },
  "/icons/badge-96.png": { size: 96, padding: 10 },
};

export function isFigureRoute(pathname: string) {
  return pathname in ICONS || /^\/api\/agents\/[A-Za-z0-9_-]+\/avatar\.png$/.test(pathname);
}

function sendPng(res: ServerResponse, png: Buffer, maxAge: number) {
  res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Cache-Control": `public, max-age=${maxAge}` });
  res.end(png);
}

export async function handleFigureRoute(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  const icon = ICONS[pathname];
  if (icon) return sendPng(res, await figurePng(DEFAULT_LOOK, icon.size, { padding: icon.padding }), 86400);
  const agentId = pathname.split("/")[3];
  const [agent] = await getDb().select({ look: schema.agents.look }).from(schema.agents).where(eq(schema.agents.id, agentId));
  if (!agent) {
    res.writeHead(404);
    res.end();
    return;
  }
  sendPng(res, await figurePng(agent.look, 192, { padding: 12 }), 3600);
}
