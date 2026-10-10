CREATE TABLE "slack_threads" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"thread_ts" text,
	"assistant" boolean DEFAULT false NOT NULL,
	"progress_ts" text,
	"progress_run_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "slack_threads" ADD CONSTRAINT "slack_threads_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_threads_thread_idx" ON "slack_threads" USING btree ("channel","thread_ts");