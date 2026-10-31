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

// People who can sign in. Today one person owns all the data; every key and session already names its user,
// so scoping data per user later is a matter of adding user_id to the data tables.
export const users = pgTable("users", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  email: text("email").notNull().unique(), // stored lowercase
  passwordHash: text("password_hash").notNull(), // scrypt, never the password
  createdAt,
});

// Merchant names the owner has marked as a subscription. Cadence is theirs to set; amounts
// still come from the synced transactions.
export const recurringTags = pgTable("recurring_tags", {
  key: text("key").primaryKey(), // normalized merchant name
  name: text("name").notNull(),
  cadence: text("cadence").notNull(), // weekly | every two weeks | monthly | quarterly | yearly
  bucket: text("bucket").notNull().default("other"), // rent | utils | other
  createdAt,
});

// Owner-set category on a Plaid transaction. source_id matches events.source_id.
export const txnOverrides = pgTable("txn_overrides", {
  sourceId: text("source_id").primaryKey(),
  category: text("category").notNull(),
  createdAt,
});

// Access keys for clients that cannot hold a login session (iPhone Shortcuts, widgets, agents).
// Only a SHA-256 hash is stored; the key itself is shown once, when it is created.
export const apiTokens = pgTable("api_tokens", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("shortcut"), // shortcut | widget | agent; becomes the source label on what it writes
  prefix: text("prefix").notNull(), // first characters of the key, so it can be recognised in a list
  tokenHash: text("token_hash").notNull().unique(),
  userId: bigint("user_id", { mode: "number" }).references(() => users.id), // null on keys made before users existed: they belong to the owner
  scopes: text("scopes").array().notNull(), // log:write | log:read
  createdAt,
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  scopesCustom: boolean("scopes_custom").notNull().default(false), // true once the owner edits a phone key's permissions
});

// The owner's to-do list. Lives here (not in an agent session) so every session and client sees the same list.
export const todos = pgTable(
  "todos",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    title: text("title").notNull(),
    note: text("note"),
    status: text("status").notNull().default("open"), // open | done | dropped
    due: date("due"), // plain YYYY-MM-DD, optional
    source: text("source").notNull().default("web"), // who added it: web | agent | app
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("todos_status_idx").on(t.status, t.createdAt)],
);

// Things the owner is on the lookout for. A want is the need ("a jacket"); its options are the
// candidates ("this one at that store"). Only one option is ever bought. A want may have a single option.
export const wants = pgTable("wants", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  title: text("title").notNull(),
  note: text("note"),
  budgetCents: integer("budget_cents"), // most the owner would pay for any option
  status: text("status").notNull().default("want"), // want | bought | dropped
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wantOptions = pgTable(
  "want_options",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    wantId: bigint("want_id", { mode: "number" }).notNull().references(() => wants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url"),
    priceCents: integer("price_cents"), // latest price seen
    priceCheckedAt: timestamp("price_checked_at", { withTimezone: true }),
    targetCents: integer("target_cents"), // buy at or below this
    note: text("note"),
    status: text("status").notNull().default("considering"), // considering | chosen | rejected
    createdAt,
  },
  (t) => [index("want_options_want_idx").on(t.wantId)],
);

// Mail pulled from the owner's Outlook mailbox so agents have context. Re-syncable, so never backed up.
export const emails = pgTable(
  "emails",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sourceId: text("source_id").notNull().unique(), // Graph immutable message id
    folder: text("folder").notNull(), // inbox | archive | sentitems
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    fromName: text("from_name"),
    fromAddress: text("from_address"),
    subject: text("subject").notNull().default(""),
    bodyText: text("body_text").notNull().default(""), // plain text, capped
    isRead: boolean("is_read").notNull().default(false),
    hasAttachments: boolean("has_attachments").notNull().default(false),
    conversationId: text("conversation_id"),
    category: text("category").notNull().default("other"), // receipt | shipping | bill | appointment | deal | other
    extracted: jsonb("extracted").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (t) => [index("emails_received_idx").on(t.receivedAt), index("emails_category_idx").on(t.category, t.receivedAt)],
);

// Where the owner's phone reported being: visit arrivals and departures plus significant moves. Exact coordinates, kept.
export const locationPoints = pgTable(
  "location_points",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clientId: text("client_id").notNull().unique(), // chosen by the phone, so a retried upload never stores twice
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    accuracyM: doublePrecision("accuracy_m"),
    source: text("source").notNull(), // visit-arrival | visit-departure | significant | manual
    createdAt,
  },
  (t) => [index("location_points_ts_idx").on(t.ts)],
);

// Text copied from the owner's shared Notion pages so agents have context. Re-syncable, so never backed up.
// generation says which full walk last saw the page; a finished walk deletes older generations.
export const notes = pgTable(
  "notes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sourceId: text("source_id").notNull().unique(), // page:<uuid>
    title: text("title").notNull().default(""),
    url: text("url"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    parentId: text("parent_id"),
    bodyText: text("body_text").notNull().default(""),
    generation: integer("generation").notNull().default(0),
    createdAt,
  },
  (t) => [index("notes_edited_idx").on(t.editedAt)],
);

// Owner preferences that used to be constants in code, changed by the owner or an agent without a deploy.
// Only keys in lib/settings-core.ts are accepted; a missing row means the built-in default.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// The repeating week for Fitness → Plan. weekday 0 is Monday. A null start is all day.
// Saving a row rewrites calendar events (source "plan") from today through the next eight weeks.
export const planSlots = pgTable(
  "plan_slots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    weekday: integer("weekday").notNull(),
    kind: text("kind").notNull(), // workout | prep
    title: text("title").notNull(),
    notes: text("notes"),
    startMin: integer("start_min"),
    durationMin: integer("duration_min"),
    createdAt,
  },
  (t) => [
    check("plan_slots_weekday", sql`${t.weekday} between 0 and 6`),
    check("plan_slots_kind", sql`${t.kind} in ('workout', 'prep')`),
    check("plan_slots_start", sql`${t.startMin} is null or ${t.startMin} between 0 and 1439`),
    check("plan_slots_duration", sql`${t.durationMin} is null or ${t.durationMin} between 1 and 720`),
  ],
);
