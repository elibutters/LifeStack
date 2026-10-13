CREATE TABLE "location_points" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"accuracy_m" double precision,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_points_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE INDEX "location_points_ts_idx" ON "location_points" USING btree ("ts");