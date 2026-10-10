CREATE TABLE "inbound_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"message" jsonb NOT NULL,
	"source" text NOT NULL,
	"slack_channel" text,
	"slack_thread_ts" text,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD CONSTRAINT "inbound_queue_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_queue_agent_idx" ON "inbound_queue" USING btree ("agent_id","created_at");