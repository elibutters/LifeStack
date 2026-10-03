import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index";

// DDL should go over a direct connection, not a transaction-mode pooler, when the
// provider offers one.
const { db, client } = createDb(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, 1);
await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
await client.end();
console.log("migrations applied");
