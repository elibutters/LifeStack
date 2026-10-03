CREATE TABLE "connections" (
	"provider" text PRIMARY KEY NOT NULL,
	"account" text,
	"refresh_token_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
