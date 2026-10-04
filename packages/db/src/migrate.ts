import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index";

// DDL should go over a direct connection, not a transaction-mode pooler, when the
// provider offers one.
// Migrations reach a hosted database through the deploy. Running them from a laptop against it has to
// be asked for explicitly, so a schema never changes ahead of the code that expects it by accident.
const target = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "";
const isLocal = /(\/\/|@)(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(target);
if (!isLocal && process.env.VERCEL !== "1" && process.env.ALLOW_REMOTE_MIGRATE !== "1") {
  console.error("migrate: refusing to change a hosted database from here (set ALLOW_REMOTE_MIGRATE=1 to do it on purpose)");
  process.exit(1);
}

const { db, client } = createDb(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, 1);
await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
await client.end();
console.log("migrations applied");
