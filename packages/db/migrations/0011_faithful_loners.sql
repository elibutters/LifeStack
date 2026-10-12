CREATE TABLE "wants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"url" text,
	"price_cents" integer,
	"status" text DEFAULT 'want' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
