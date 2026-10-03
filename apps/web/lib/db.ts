import { createDb, type Db } from "@lifestack/db";

// Reuse one pool across hot reloads in dev.
const g = globalThis as { __lifestackDb?: Db };

export function db(): Db {
  return (g.__lifestackDb ??= createDb().db);
}
