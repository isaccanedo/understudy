ALTER TABLE "mcp_servers" ADD COLUMN "ask_all" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "ask_tools" jsonb DEFAULT '[]'::jsonb NOT NULL;