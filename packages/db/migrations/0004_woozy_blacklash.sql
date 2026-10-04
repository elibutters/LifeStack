CREATE TABLE "plaid_items" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"institution_id" text,
	"institution_name" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"cursor" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "item_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "plaid_account_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "subtype" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "current_balance" double precision;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "available_balance" double precision;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "credit_limit" double precision;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "balance_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_item_id_plaid_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."plaid_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plaid_account_id_unique" UNIQUE("plaid_account_id");