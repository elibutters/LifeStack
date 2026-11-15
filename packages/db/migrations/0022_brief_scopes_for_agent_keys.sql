-- The daily briefs added two permissions, brief:read and brief:write. An agent key keeps exactly the permissions it was made with, so the
-- agent key that runs the morning and evening briefs could not save one. Give the keys that exist now (agent keys only, not revoked) the two
-- new permissions, once. Phone keys follow the app's current permissions on their own, and keys made later choose their own.
UPDATE "api_tokens" SET "scopes" = array_append("scopes", 'brief:read') WHERE "kind" = 'agent' AND "revoked_at" IS NULL AND NOT ('brief:read' = ANY("scopes"));
--> statement-breakpoint
UPDATE "api_tokens" SET "scopes" = array_append("scopes", 'brief:write') WHERE "kind" = 'agent' AND "revoked_at" IS NULL AND NOT ('brief:write' = ANY("scopes"));
