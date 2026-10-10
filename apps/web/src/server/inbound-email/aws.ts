import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

export type AwsCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiresAt?: number };

let cached: AwsCredentials | null = null;

function tag(xml: string, name: string) {
  return xml.match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1];
}

export async function awsCredentials(env: NodeJS.ProcessEnv = process.env): Promise<AwsCredentials> {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    return { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN };
  }
  if (cached?.expiresAt && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached;
  const roleArn = env.AWS_ROLE_ARN;
  const tokenFile = env.AWS_WEB_IDENTITY_TOKEN_FILE;
  if (!roleArn || !tokenFile) throw new Error("no AWS credentials: set AWS_ROLE_ARN with AWS_WEB_IDENTITY_TOKEN_FILE, or AWS_ACCESS_KEY_ID");
  const token = (await readFile(tokenFile, "utf8")).trim();
  const region = env.AWS_REGION || "us-east-1";
  const query = new URLSearchParams({
    Action: "AssumeRoleWithWebIdentity",
    Version: "2011-06-15",
    RoleArn: roleArn,
    RoleSessionName: "understudy-web",
    WebIdentityToken: token,
    DurationSeconds: "3600",
  });
  const response = await fetch(`https://sts.${region}.amazonaws.com/?${query}`, { signal: AbortSignal.timeout(10000) });
  const xml = await response.text();
  if (!response.ok) throw new Error(`sts ${response.status}: ${tag(xml, "Message") ?? "error"}`);
  const accessKeyId = tag(xml, "AccessKeyId");
  const secretAccessKey = tag(xml, "SecretAccessKey");
  const sessionToken = tag(xml, "SessionToken");
  const expiration = tag(xml, "Expiration");
  if (!accessKeyId || !secretAccessKey || !sessionToken) throw new Error("sts returned no credentials");
  cached = { accessKeyId, secretAccessKey, sessionToken, expiresAt: expiration ? Date.parse(expiration) : Date.now() + 15 * 60 * 1000 };
  return cached;
}

function sha256(data: string) {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function encodeKey(key: string) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

export function signS3Get(bucket: string, key: string, region: string, credentials: AwsCredentials, now = new Date()) {
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const path = `/${encodeKey(key)}`;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    "x-amz-date": amzDate,
  };
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;
  const names = Object.keys(headers).sort();
  const canonical = ["GET", path, "", ...names.map((name) => `${name}:${headers[name]}`), "", names.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign, "utf8").digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return { url: `https://${host}${path}`, headers };
}

export async function s3GetObject(bucket: string, key: string, region: string, maxBytes: number) {
  const credentials = await awsCredentials();
  const { url, headers } = signS3Get(bucket, key, region, credentials);
  const { host: _host, ...sent } = headers;
  const response = await fetch(url, { headers: sent, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`s3 get ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new Error("email too large");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > maxBytes) throw new Error("email too large");
  return body;
}
