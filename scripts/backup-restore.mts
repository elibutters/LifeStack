// Restores an encrypted backup file into the database in DATABASE_URL, replacing its contents.
// Usage: pnpm backup:restore path/to/lifestack-YYYY-MM-DD.bin
// Refuses a hosted database unless ALLOW_REMOTE_RESTORE=1, because it overwrites everything.
import { readFileSync } from "node:fs";
import { createDb } from "@lifestack/db";
import { unpackBackup } from "../apps/web/lib/backup-core.ts";
import { restoreTables } from "../apps/web/lib/backup-db.ts";

const file = process.argv[2];
const url = process.env.DATABASE_URL ?? "";
if (!file) { console.error("usage: pnpm backup:restore <file>"); process.exit(2); }
const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
if (!local && process.env.ALLOW_REMOTE_RESTORE !== "1") {
  console.error("refusing to overwrite a hosted database; set ALLOW_REMOTE_RESTORE=1 if you mean it");
  process.exit(2);
}
const dump = unpackBackup(readFileSync(file), process.env.ENCRYPTION_KEY ?? "");
const { db, client } = createDb(url);
await restoreTables(db, dump.tables);
await client.end();
console.log(`restored ${Object.keys(dump.tables).length} tables from ${dump.createdAt}`);
