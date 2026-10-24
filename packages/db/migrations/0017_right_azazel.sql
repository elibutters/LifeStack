CREATE TABLE "notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"url" text,
	"edited_at" timestamp with time zone,
	"parent_id" text,
	"body_text" text DEFAULT '' NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE INDEX "notes_edited_idx" ON "notes" USING btree ("edited_at");