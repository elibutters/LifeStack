CREATE TABLE "auth_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_attempts_ts_idx" ON "auth_attempts" USING btree ("ts");