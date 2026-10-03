CREATE TABLE "accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"institution" text,
	"type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"domain" text NOT NULL,
	"key" text NOT NULL,
	"value_num" double precision,
	"value_text" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_source_source_id_key" UNIQUE("source","source_id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"relation" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"radius_m" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dose" double precision,
	"unit" text,
	"timing" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"source" text PRIMARY KEY NOT NULL,
	"cursor" text,
	"last_ok_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due" date,
	"week" date,
	"area" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"place_id" bigint NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"duration_min" integer
);
--> statement-breakpoint
CREATE TABLE "weekly_reviews" (
	"week_start" date PRIMARY KEY NOT NULL,
	"wins" text,
	"misses" text,
	"plan_next" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_domain_key_ts_idx" ON "events" USING btree ("domain","key","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_payload_idx" ON "events" USING gin ("payload");--> statement-breakpoint
CREATE INDEX "visits_arrived_at_idx" ON "visits" USING btree ("arrived_at" DESC NULLS LAST);