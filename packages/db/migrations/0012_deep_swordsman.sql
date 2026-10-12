CREATE TABLE "want_options" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"want_id" bigint NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"price_cents" integer,
	"price_checked_at" timestamp with time zone,
	"target_cents" integer,
	"note" text,
	"status" text DEFAULT 'considering' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wants" ADD COLUMN "budget_cents" integer;--> statement-breakpoint
ALTER TABLE "want_options" ADD CONSTRAINT "want_options_want_id_wants_id_fk" FOREIGN KEY ("want_id") REFERENCES "public"."wants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "want_options_want_idx" ON "want_options" USING btree ("want_id");--> statement-breakpoint
-- Existing wants that had a link or price become a want with one option.
INSERT INTO "want_options" ("want_id", "title", "url", "price_cents", "status") SELECT "id", "title", "url", "price_cents", CASE "status" WHEN 'bought' THEN 'chosen' WHEN 'dropped' THEN 'rejected' ELSE 'considering' END FROM "wants" WHERE "url" IS NOT NULL OR "price_cents" IS NOT NULL;
