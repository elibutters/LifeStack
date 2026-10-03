import { sql } from "drizzle-orm";
import { createDb } from "@lifestack/db";

// M0 skeleton: prove the container can reach Postgres, then idle.
// M2 adds one file per source (src/<source>.ts exporting sync(cursor) -> {rows, nextCursor})
// and a scheduler that upserts rows and advances sync_state.
const { db } = createDb();
await db.execute(sql`select 1`);
console.log("workers: database reachable, no sources configured yet");

setInterval(() => {}, 1 << 30);
