ALTER TABLE "recipes" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "input" text;