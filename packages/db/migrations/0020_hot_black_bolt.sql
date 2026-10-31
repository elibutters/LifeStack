CREATE TABLE "todos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"due" date,
	"source" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "todos_status_idx" ON "todos" USING btree ("status","created_at");