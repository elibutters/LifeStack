CREATE TABLE "plan_slots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"weekday" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"start_min" integer,
	"duration_min" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_slots_weekday" CHECK ("plan_slots"."weekday" between 0 and 6),
	CONSTRAINT "plan_slots_kind" CHECK ("plan_slots"."kind" in ('workout', 'prep')),
	CONSTRAINT "plan_slots_start" CHECK ("plan_slots"."start_min" is null or "plan_slots"."start_min" between 0 and 1439),
	CONSTRAINT "plan_slots_duration" CHECK ("plan_slots"."duration_min" is null or "plan_slots"."duration_min" between 1 and 720)
);
