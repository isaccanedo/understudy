import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { hashToken } from "@/lib/ids";
import { sameSecret } from "@/lib/secret-compare";
import type { Hub } from "./hub";
import { RateLimiter } from "./rate-limit";

const MAX_BODY_BYTES = 64 * 1024;
const limiter = new RateLimiter();

function reply(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function clientIp(req: IncomingMessage) {
  const forwarded = req.headers["x-forwarded-for"];
  const chain = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return chain.at(-1) ?? req.socket.remoteAddress ?? "unknown";
}

export async function handleWebhook(hub: Hub, req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" });
  const [, , , recipeId, secret] = pathname.split("/");
  if (!recipeId || !secret) return reply(res, 404, { error: "not_found" });
  if (!limiter.allow(`hook-ip:${clientIp(req)}`, 1, 20)) return reply(res, 429, { error: "too_many_requests" });
  const [recipe] = await getDb()
    .select({ id: schema.recipes.id, secretHash: schema.recipes.webhookSecretHash, active: schema.recipes.active })
    .from(schema.recipes)
    .where(eq(schema.recipes.id, recipeId));
  if (!recipe?.secretHash || !sameSecret(recipe.secretHash, hashToken(secret))) return reply(res, 404, { error: "not_found" });
  if (!limiter.allow(`hook:${recipeId}`, 0.5, 10)) return reply(res, 429, { error: "too_many_requests" });
  if (!recipe.active) return reply(res, 409, { error: "recipe_paused" });
  const body = await readBody(req);
  if (body === null) return reply(res, 413, { error: "body_too_large" });
  const result = await hub.startRun(recipe.id, "webhook", { input: body || undefined });
  console.log(JSON.stringify({ at: new Date().toISOString(), event: "webhook_received", recipeId, ok: result.ok }));
  if (!result.ok) return reply(res, result.reason === "offline" ? 503 : 409, { error: result.reason, runId: "runId" in result ? result.runId : undefined });
  return reply(res, 202, { runId: result.runId });
}
