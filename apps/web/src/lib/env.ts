import { ARTIFACT_MAX_BYTES, uploadLimitFrom } from "@understudy/protocol";
import { AGENT_TALK_CEILING_ENV, parseTalkCeiling } from "./agent-talk";
import { trustedForAdminList } from "./approval-policy";

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export const env = {
  get productName() {
    return process.env.UNDERSTUDY_PRODUCT_NAME?.trim() || "Understudy";
  },
  get publicUrl() {
    return (process.env.UNDERSTUDY_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
  },
  get allowedEmailDomains() {
    return list(process.env.UNDERSTUDY_ALLOWED_EMAIL_DOMAIN).map((domain) => domain.replace(/^@/, ""));
  },
  get adminEmails() {
    return list(process.env.UNDERSTUDY_ADMIN_EMAILS);
  },
  get slackBotToken() {
    return process.env.SLACK_BOT_TOKEN?.trim() || undefined;
  },
  get hostToken() {
    return process.env.UNDERSTUDY_HOST_TOKEN?.trim() || undefined;
  },
  get computerServerUrl() {
    return (process.env.UNDERSTUDY_COMPUTER_SERVER_URL?.trim() || this.publicUrl).replace(/\/$/, "");
  },
  get computerImage() {
    return process.env.UNDERSTUDY_COMPUTER_IMAGE?.trim() ?? "";
  },
  get hostIds() {
    return list(process.env.UNDERSTUDY_HOST_IDS);
  },
  get agentTalkCeiling() {
    return parseTalkCeiling(process.env[AGENT_TALK_CEILING_ENV]);
  },
  get uploadMaxBytes() {
    return uploadLimitFrom(process.env.UNDERSTUDY_UPLOAD_MAX_BYTES);
  },
  get artifactOrigin() {
    const raw = process.env.UNDERSTUDY_ARTIFACT_ORIGIN?.trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
    } catch {
      return null;
    }
  },
  get artifactMaxBytes() {
    const n = Number(process.env.UNDERSTUDY_ARTIFACT_MAX_BYTES);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : ARTIFACT_MAX_BYTES;
  },
  get artifactAgentMaxBytes() {
    const n = Number(process.env.UNDERSTUDY_ARTIFACT_AGENT_MAX_BYTES);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1024 * 1024 * 1024;
  },
  get artifactBucket() {
    const bucket = process.env.UNDERSTUDY_ARTIFACT_S3_BUCKET?.trim();
    if (!bucket) return null;
    const region = process.env.UNDERSTUDY_ARTIFACT_S3_REGION?.trim() || process.env.AWS_REGION?.trim() || "us-east-1";
    return {
      bucket,
      region,
      endpoint: (process.env.UNDERSTUDY_ARTIFACT_S3_ENDPOINT?.trim() || `https://s3.${region}.amazonaws.com`).replace(/\/$/, ""),
      accessKeyId: process.env.UNDERSTUDY_ARTIFACT_S3_ACCESS_KEY_ID?.trim() || process.env.AWS_ACCESS_KEY_ID?.trim() || "",
      secretAccessKey: process.env.UNDERSTUDY_ARTIFACT_S3_SECRET_ACCESS_KEY?.trim() || process.env.AWS_SECRET_ACCESS_KEY?.trim() || "",
      sessionToken: process.env.AWS_SESSION_TOKEN?.trim() || undefined,
    };
  },
  get googleEnabled() {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  },
};

export function isAdminEmail(email: string) {
  return env.adminEmails.includes(email.trim().toLowerCase());
}

export function isAdmin(email: string, flaggedAdmin: boolean, source?: string | null) {
  return env.adminEmails.length > 0 ? isAdminEmail(email) && trustedForAdminList(source) : flaggedAdmin;
}

export function isAllowedEmail(email: string) {
  const domains = env.allowedEmailDomains;
  if (domains.length === 0) return true;
  const address = email.trim().toLowerCase();
  return domains.some((domain) => address.endsWith(`@${domain}`));
}
