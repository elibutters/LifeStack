CREATE TABLE "recurring_tags" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cadence" text NOT NULL,
	"bucket" text DEFAULT 'other' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "txn_overrides" (
	"source_id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
