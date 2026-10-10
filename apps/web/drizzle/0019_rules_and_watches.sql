CREATE TABLE "recipe_watches" (
	"recipe_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"url" text NOT NULL,
	"part" text,
	"every_minutes" integer DEFAULT 15 NOT NULL,
	"last_hash" text,
	"last_text" text,
	"last_error" text,
	"checked_at" timestamp with time zone,
	"changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "rules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_watches" ADD CONSTRAINT "recipe_watches_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_watches" ADD CONSTRAINT "recipe_watches_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_watches_agent_idx" ON "recipe_watches" USING btree ("agent_id");