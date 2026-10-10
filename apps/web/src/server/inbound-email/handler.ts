import type { IncomingMessage, ServerResponse } from "node:http";
import { FILE_MAX_BYTES } from "@understudy/protocol";
import { hashToken } from "@/lib/ids";
import { sameSecret } from "@/lib/secret-compare";
import type { Hub } from "../hub";
import { RateLimiter } from "../rate-limit";
import { clientIp } from "../webhook";
import { s3GetObject } from "./aws";
import { inboundConfig, type InboundConfig } from "./config";
import { findInboundTask, type InboundTask } from "./lookup";
import { parseEmail, type ParsedEmail } from "./parse";
import { inboundLocalParts, parseSenderList, senderAllowed, verdictProblem, type SesVerdicts } from "./policy";
import { confirmSubscription, parseSnsMessage, verifySnsMessage, type CertFetcher } from "./sns";

const MAX_SNS_BYTES = 256 * 1024;
const MAX_RAW_BYTES = 30 * 1024 * 1024;

export type InboundDeps = {
  config: () => InboundConfig;
  findTask: (localPart: string) => Promise<InboundTask | null>;
  fetchRaw: (bucket: string, key: string, region: string, maxBytes: number) => Promise<Buffer>;
  fetchCert?: CertFetcher;
  confirm?: typeof confirmSubscription;
  now?: () => number;
};

const defaultDeps: InboundDeps = { config: inboundConfig, findTask: findInboundTask, fetchRaw: s3GetObject };

const limiter = new RateLimiter();
const seen = new Map<string, number>();

function reply(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

async function readBody(req: IncomingMessage, max: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function firstTime(id: string, now: number) {
  for (const [key, at] of seen) if (now - at > 60 * 60 * 1000) seen.delete(key);
  if (seen.has(id)) return false;
  seen.set(id, now);
  return true;
}

function stamp(now: number) {
  return new Date(now).toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
}

export function emailRunInput(email: ParsedEmail, files: string[]) {
  return JSON.stringify({
    from: email.from,
    fromName: email.fromName,
    to: email.to,
    subject: email.subject,
    date: email.date,
    text: email.text,
    attachments: files,
  });
}

export type Outcome = { localPart: string; result: string; runId?: string };

export async function processEmail(hub: Hub, deps: InboundDeps, raw: Buffer, recipients: string[], problem: string | null): Promise<Outcome[]> {
  const config = deps.config();
  const now = (deps.now ?? Date.now)();
  const email = await parseEmail(raw, FILE_MAX_BYTES);
  const localParts = inboundLocalParts([...recipients, ...email.to], config.domain);
  const outcomes: Outcome[] = [];
  for (const localPart of localParts) {
    const task = await deps.findTask(localPart);
    if (!task) {
      outcomes.push({ localPart, result: "unknown_address" });
      continue;
    }
    if (problem) {
      outcomes.push({ localPart, result: problem });
      continue;
    }
    if (!senderAllowed(email.from, parseSenderList(task.allowedSenders), task.ownerEmail)) {
      outcomes.push({ localPart, result: "sender_not_allowed" });
      continue;
    }
    if (!task.active) {
      outcomes.push({ localPart, result: "task_paused" });
      continue;
    }
    if (!limiter.allow(`email:${task.recipeId}`, 0.2, 5)) {
      outcomes.push({ localPart, result: "too_many_emails" });
      continue;
    }
    const files: string[] = [];
    for (const attachment of email.attachments) {
      const path = `email-${stamp(now)}-${attachment.filename}`;
      await hub.deliver(task.agentId, { type: "file_put", path, base64: attachment.base64 }, { source: "email" });
      files.push(path);
    }
    const result = await hub.startRun(task.recipeId, "email", { input: emailRunInput(email, files) });
    outcomes.push(result.ok ? { localPart, result: "started", runId: result.runId } : { localPart, result: result.reason });
  }
  return outcomes;
}

type SesNotification = {
  notificationType?: string;
  mail?: { messageId?: string; destination?: string[] };
  receipt?: SesVerdicts & { recipients?: string[]; action?: { type?: string; bucketName?: string; objectKey?: string } };
};

async function handleSns(hub: Hub, deps: InboundDeps, req: IncomingMessage, res: ServerResponse) {
  const config = deps.config();
  const body = await readBody(req, MAX_SNS_BYTES);
  if (!body) return reply(res, 413, { error: "body_too_large" });
  const message = parseSnsMessage(body.toString("utf8"));
  if (!message) return reply(res, 400, { error: "bad_message" });
  if (!config.topicArn || message.TopicArn !== config.topicArn) return reply(res, 403, { error: "unknown_topic" });
  if (!(await verifySnsMessage(message, deps.fetchCert, (deps.now ?? Date.now)()))) return reply(res, 403, { error: "bad_signature" });
  if (message.Type === "SubscriptionConfirmation") {
    const ok = await (deps.confirm ?? confirmSubscription)(message);
    log("inbound_email_subscription", { ok });
    return reply(res, ok ? 200 : 502, { ok });
  }
  if (message.Type === "UnsubscribeConfirmation") return reply(res, 200, { ok: true });
  let notification: SesNotification;
  try {
    notification = JSON.parse(message.Message) as SesNotification;
  } catch {
    return reply(res, 400, { error: "bad_notification" });
  }
  const action = notification.receipt?.action;
  if (notification.notificationType !== "Received" || action?.type !== "S3" || !action.objectKey || !action.bucketName) {
    return reply(res, 200, { ignored: true });
  }
  if (action.bucketName !== config.bucket || !action.objectKey.startsWith("raw/")) return reply(res, 403, { error: "unknown_bucket" });
  const id = notification.mail?.messageId ?? message.MessageId;
  if (!firstTime(id, (deps.now ?? Date.now)())) return reply(res, 200, { duplicate: true });
  const raw = await deps.fetchRaw(action.bucketName, action.objectKey, config.region, MAX_RAW_BYTES);
  const outcomes = await processEmail(hub, deps, raw, notification.receipt?.recipients ?? [], verdictProblem(notification.receipt));
  log("inbound_email", { source: "ses", messageId: id, outcomes });
  return reply(res, 200, { outcomes });
}

async function handleRaw(hub: Hub, deps: InboundDeps, req: IncomingMessage, res: ServerResponse) {
  const config = deps.config();
  const header = req.headers.authorization ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!config.rawTokenHash || !given || !sameSecret(config.rawTokenHash, hashToken(given))) return reply(res, 401, { error: "unauthorized" });
  const raw = await readBody(req, MAX_RAW_BYTES);
  if (!raw) return reply(res, 413, { error: "body_too_large" });
  const recipientHeader = req.headers["x-understudy-recipients"];
  const recipients = (Array.isArray(recipientHeader) ? recipientHeader.join(",") : recipientHeader ?? "").split(",").filter(Boolean);
  const outcomes = await processEmail(hub, deps, raw, recipients, null);
  log("inbound_email", { source: "raw", outcomes });
  return reply(res, 202, { outcomes });
}

export async function handleInboundEmail(hub: Hub, req: IncomingMessage, res: ServerResponse, deps: InboundDeps = defaultDeps) {
  if (req.method !== "POST") return reply(res, 405, { error: "method_not_allowed" });
  if (!deps.config().domain) return reply(res, 404, { error: "not_found" });
  if (!limiter.allow(`email-ip:${clientIp(req)}`, 2, 40)) return reply(res, 429, { error: "too_many_requests" });
  if (req.headers["x-amz-sns-message-type"]) return handleSns(hub, deps, req, res);
  return handleRaw(hub, deps, req, res);
}
