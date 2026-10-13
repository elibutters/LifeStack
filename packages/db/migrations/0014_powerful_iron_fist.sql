CREATE TABLE "emails" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"folder" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"from_name" text,
	"from_address" text,
	"subject" text DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"conversation_id" text,
	"category" text DEFAULT 'other' NOT NULL,
	"extracted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emails_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE INDEX "emails_received_idx" ON "emails" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "emails_category_idx" ON "emails" USING btree ("category","received_at");