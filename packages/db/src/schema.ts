import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// The spine: every measurement and log, from every source.
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    domain: text("domain").notNull(), // sleep | finance | supplement | calendar | email | location | log | work | commerce
    key: text("key").notNull(), // e.g. sleep.duration_min, supplement.taken, mood
    valueNum: doublePrecision("value_num"),
    valueText: text("value_text"),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    source: text("source").notNull(), // oura | gcal | monarch | manual | shortcut | owntracks | agent
    sourceId: text("source_id"), // upstream id, for idempotent upserts
    createdAt,
  },
  (t) => [
    unique("events_source_source_id_key").on(t.source, t.sourceId),
    index("events_domain_key_ts_idx").on(t.domain, t.key, t.ts.desc()),
    index("events_payload_idx").using("gin", t.payload),
  ],
);

export const tasks = pgTable("tasks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull().default("open"),
  due: date("due"),
  week: date("week"), // Monday of the week this item is planned for
  area: text("area"),
  createdAt,
});

export const people = pgTable("people", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  relation: text("relation"),
  notes: text("notes"),
  createdAt,
});

export const supplements = pgTable("supplements", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  dose: doublePrecision("dose"),
  unit: text("unit"),
  timing: text("timing"),
  active: boolean("active").notNull().default(true),
  createdAt,
});

// A linked Plaid login at one institution. The access token is stored encrypted.
export const plaidItems = pgTable("plaid_items", {
  id: text("id").primaryKey(), // Plaid item_id
  kind: text("kind").notNull(), // bank | brokerage
  env: text("env").notNull().default("sandbox"), // sandbox | production: never synced across environments
  institutionId: text("institution_id"),
  institutionName: text("institution_name").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  cursor: text("cursor"), // transactions sync cursor; advances only together with the data
  status: text("status").notNull().default("ok"), // ok | login_required | error
  lastError: text("last_error"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }), // held while a sync runs
  createdAt,
});

// Labels and balances only. Never account numbers.
export const accounts = pgTable("accounts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  nickname: text("nickname"), // owner's display name; name stays the institution's label
  institution: text("institution"),
  type: text("type"),
  itemId: text("item_id").references(() => plaidItems.id, { onDelete: "cascade" }),
  plaidAccountId: text("plaid_account_id").unique(),
  subtype: text("subtype"),
  currency: text("currency"),
  currentBalance: doublePrecision("current_balance"),
  availableBalance: doublePrecision("available_balance"),
  creditLimit: doublePrecision("credit_limit"),
  balanceAt: timestamp("balance_at", { withTimezone: true }),
  createdAt,
});

export const places = pgTable("places", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  label: text("label").notNull(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  radiusM: integer("radius_m").notNull().default(100),
  createdAt,
});

export const visits = pgTable(
  "visits",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    placeId: bigint("place_id", { mode: "number" })
      .notNull()
      .references(() => places.id),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }).notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    durationMin: integer("duration_min"),
  },
  (t) => [index("visits_arrived_at_idx").on(t.arrivedAt.desc())],
);

export const weeklyReviews = pgTable("weekly_reviews", {
  weekStart: date("week_start").primaryKey(),
  wins: text("wins"),
  misses: text("misses"),
  planNext: text("plan_next"),
  metrics: jsonb("metrics").notNull().default(sql`'{}'::jsonb`),
  createdAt,
});

export const syncState = pgTable("sync_state", {
  source: text("source").primaryKey(),
  cursor: text("cursor"),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastError: text("last_error"),
  // A sync holds this until it finishes (or it expires), so two syncs never overlap.
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
});

// Failed sign-in attempts, kept only long enough to rate limit.
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip").notNull(),
  },
  (t) => [index("auth_attempts_ts_idx").on(t.ts)],
);

// Linked third-party accounts. Tokens are encrypted before they are stored.
export const connections = pgTable("connections", {
  provider: text("provider").primaryKey(), // outlook
  account: text("account"), // display address for the UI
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row: the owner's identity for the UI and for agents. Personal values live only here, never in the repo.
export const ownerProfile = pgTable(
  "owner_profile",
  {
    id: integer("id").primaryKey(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("owner_profile_singleton", sql`${t.id} = 1`)],
);

// Access keys for clients that cannot hold a login session (iPhone Shortcuts, widgets, agents).
// Only a SHA-256 hash is stored; the key itself is shown once, when it is created.
export const apiTokens = pgTable("api_tokens", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("shortcut"), // shortcut | widget | agent; becomes the source label on what it writes
  prefix: text("prefix").notNull(), // first characters of the key, so it can be recognised in a list
  tokenHash: text("token_hash").notNull().unique(),
  scopes: text("scopes").array().notNull(), // log:write | log:read
  createdAt,
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
