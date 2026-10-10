import { createVerify } from "node:crypto";

export type SnsMessage = {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
};

export type CertFetcher = (url: string) => Promise<string>;

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const MAX_AGE_MS = 60 * 60 * 1000;

const NOTIFICATION_FIELDS = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] as const;
const SUBSCRIPTION_FIELDS = ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"] as const;

export function isSnsUrl(raw: string | undefined, pathSuffix?: string) {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
    if (!SNS_HOST.test(url.hostname)) return false;
    return pathSuffix ? url.pathname.endsWith(pathSuffix) : true;
  } catch {
    return false;
  }
}

export function parseSnsMessage(body: string): SnsMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  const required = ["Type", "MessageId", "TopicArn", "Message", "Timestamp", "SignatureVersion", "Signature", "SigningCertURL"];
  if (!required.every((key) => typeof message[key] === "string")) return null;
  if (!["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"].includes(message.Type as string)) return null;
  return message as unknown as SnsMessage;
}

export function stringToSign(message: SnsMessage) {
  const fields = message.Type === "Notification" ? NOTIFICATION_FIELDS : SUBSCRIPTION_FIELDS;
  let out = "";
  for (const field of fields) {
    const value = message[field];
    if (value === undefined) continue;
    out += `${field}\n${value}\n`;
  }
  return out;
}

const certCache = new Map<string, string>();

export const fetchCertificate: CertFetcher = async (url) => {
  const cached = certCache.get(url);
  if (cached) return cached;
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`certificate fetch failed: ${response.status}`);
  const pem = await response.text();
  if (!pem.includes("BEGIN CERTIFICATE")) throw new Error("not a certificate");
  certCache.set(url, pem);
  return pem;
};

export async function verifySnsMessage(message: SnsMessage, fetchCert: CertFetcher = fetchCertificate, now = Date.now()) {
  if (!isSnsUrl(message.SigningCertURL, ".pem")) return false;
  const algorithm = message.SignatureVersion === "1" ? "RSA-SHA1" : message.SignatureVersion === "2" ? "RSA-SHA256" : null;
  if (!algorithm) return false;
  const sentAt = Date.parse(message.Timestamp);
  if (Number.isNaN(sentAt) || Math.abs(now - sentAt) > MAX_AGE_MS) return false;
  const pem = await fetchCert(message.SigningCertURL);
  const verifier = createVerify(algorithm);
  verifier.update(stringToSign(message), "utf8");
  try {
    return verifier.verify(pem, message.Signature, "base64");
  } catch {
    return false;
  }
}

export async function confirmSubscription(message: SnsMessage, fetcher: typeof fetch = fetch) {
  if (!isSnsUrl(message.SubscribeURL)) return false;
  const response = await fetcher(message.SubscribeURL as string, { redirect: "error", signal: AbortSignal.timeout(5000) });
  return response.ok;
}
