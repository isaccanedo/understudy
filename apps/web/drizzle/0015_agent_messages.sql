CREATE TABLE "agent_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"from_agent_id" text NOT NULL,
	"to_agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"task" text,
	"run_id" text,
	"depth" integer DEFAULT 1 NOT NULL,
	"delivered" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_to_idx" ON "agent_messages" USING btree ("to_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_messages_pair_idx" ON "agent_messages" USING btree ("from_agent_id","to_agent_id","created_at");