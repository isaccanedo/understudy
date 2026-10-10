ALTER TABLE "approvals" ADD COLUMN "payload_hash" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "allowed_emails" jsonb;