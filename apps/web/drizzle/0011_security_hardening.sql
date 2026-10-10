CREATE TABLE "hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "host_id" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "webhook_secret_hash" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "source" text;--> statement-breakpoint
UPDATE "recipes" SET "webhook_secret_hash" = encode(sha256(convert_to("webhook_secret", 'UTF8')), 'hex'), "webhook_secret" = NULL WHERE "webhook_secret" IS NOT NULL;
