CREATE TABLE "owner_profile" (
	"id" integer PRIMARY KEY NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_profile_singleton" CHECK ("owner_profile"."id" = 1)
);
