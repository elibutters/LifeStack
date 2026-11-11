-- A change counter for the phone. Whenever data the app shows changes, a trigger moves one sequence forward; the phone asks
-- /api/v1/pulse for its value every few seconds and reloads when it moves. A sequence, not a row, so concurrent writers never
-- lock each other (a shared counter row could deadlock a multi-statement sync).
CREATE SEQUENCE IF NOT EXISTS "data_version_seq" AS bigint;
--> statement-breakpoint

-- events: bump only for a real change in something the app shows. MCP usage rows are bookkeeping and never count, and an upsert that
-- rewrites a row with the same content (a sync re-saving what it already had) is not a change.
CREATE OR REPLACE FUNCTION "lifestack_events_inserted"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM new_rows WHERE domain <> 'mcp') THEN
    PERFORM nextval('data_version_seq');
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "lifestack_events_updated"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM new_rows n JOIN old_rows o ON o.id = n.id
    WHERE (n.domain <> 'mcp' OR o.domain <> 'mcp')
      AND (n.domain, n.key, n.ts, n.value_num, n.value_text, n.payload) IS DISTINCT FROM (o.domain, o.key, o.ts, o.value_num, o.value_text, o.payload)
  ) THEN
    PERFORM nextval('data_version_seq');
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "lifestack_events_deleted"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM old_rows WHERE domain <> 'mcp') THEN
    PERFORM nextval('data_version_seq');
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER "events_pulse_insert" AFTER INSERT ON "events" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "lifestack_events_inserted"();
--> statement-breakpoint
CREATE TRIGGER "events_pulse_update" AFTER UPDATE ON "events" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "lifestack_events_updated"();
--> statement-breakpoint
CREATE TRIGGER "events_pulse_delete" AFTER DELETE ON "events" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "lifestack_events_deleted"();
--> statement-breakpoint

-- The other tables the phone reads: any change counts.
CREATE OR REPLACE FUNCTION "lifestack_data_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM nextval('data_version_seq');
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER "todos_pulse" AFTER INSERT OR UPDATE OR DELETE ON "todos" FOR EACH STATEMENT EXECUTE FUNCTION "lifestack_data_changed"();
--> statement-breakpoint
CREATE TRIGGER "wants_pulse" AFTER INSERT OR UPDATE OR DELETE ON "wants" FOR EACH STATEMENT EXECUTE FUNCTION "lifestack_data_changed"();
--> statement-breakpoint
CREATE TRIGGER "want_options_pulse" AFTER INSERT OR UPDATE OR DELETE ON "want_options" FOR EACH STATEMENT EXECUTE FUNCTION "lifestack_data_changed"();
--> statement-breakpoint
CREATE TRIGGER "supplements_pulse" AFTER INSERT OR UPDATE OR DELETE ON "supplements" FOR EACH STATEMENT EXECUTE FUNCTION "lifestack_data_changed"();
--> statement-breakpoint
CREATE TRIGGER "settings_pulse" AFTER INSERT OR UPDATE OR DELETE ON "settings" FOR EACH STATEMENT EXECUTE FUNCTION "lifestack_data_changed"();
