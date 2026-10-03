import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  // prepare: false keeps this compatible with transaction-mode poolers (PgBouncer),
  // which hosted providers use for serverless connections.
  const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20 });
  return { db: drizzle(client, { schema }), client };
}

export type Db = ReturnType<typeof createDb>["db"];
