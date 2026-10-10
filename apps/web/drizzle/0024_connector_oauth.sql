CREATE TABLE "mcp_server_logins" (
	"server_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tokens" text,
	"state" text,
	"verifier" text,
	"return_to" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_server_logins_server_id_user_id_pk" PRIMARY KEY("server_id","user_id"),
	CONSTRAINT "mcp_server_logins_state_unique" UNIQUE("state")
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "oauth_client" text;--> statement-breakpoint
ALTER TABLE "mcp_server_logins" ADD CONSTRAINT "mcp_server_logins_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_logins" ADD CONSTRAINT "mcp_server_logins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;