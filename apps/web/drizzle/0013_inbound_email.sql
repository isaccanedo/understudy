CREATE TABLE "recipe_inbound" (
	"recipe_id" text PRIMARY KEY NOT NULL,
	"local_part" text NOT NULL,
	"allowed_senders" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_inbound_local_part_unique" UNIQUE("local_part")
);
--> statement-breakpoint
ALTER TABLE "recipe_inbound" ADD CONSTRAINT "recipe_inbound_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;