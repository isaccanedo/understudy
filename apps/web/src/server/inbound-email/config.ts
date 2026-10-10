import { hashToken } from "@/lib/ids";

export type InboundConfig = {
  domain: string;
  topicArn: string;
  bucket: string;
  region: string;
  rawTokenHash: string;
};

export function inboundConfig(env: NodeJS.ProcessEnv = process.env): InboundConfig {
  const rawToken = env.UNDERSTUDY_INBOUND_TOKEN?.trim() ?? "";
  return {
    domain: (env.UNDERSTUDY_INBOUND_EMAIL_DOMAIN ?? "").trim().toLowerCase().replace(/^@/, ""),
    topicArn: (env.UNDERSTUDY_INBOUND_SNS_TOPIC_ARN ?? "").trim(),
    bucket: (env.UNDERSTUDY_INBOUND_S3_BUCKET ?? "").trim(),
    region: (env.AWS_REGION ?? env.UNDERSTUDY_INBOUND_SNS_TOPIC_ARN?.split(":")[3] ?? "us-east-1").trim(),
    rawTokenHash: rawToken.length >= 24 ? hashToken(rawToken) : "",
  };
}
