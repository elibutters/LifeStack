import { sql } from "drizzle-orm";
import type { Db } from "@lifestack/db";

// Tables left out: migration bookkeeping and the login attempt counter (noise, not data).
const SKIP = new Set(["__drizzle_migrations", "auth_attempts"]);

async function tableNames(db: Db): Promise<string[]> {
  const rows = await db.execute<{ t: string }>(sql`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  return [...rows].map((r) => r.t).filter((t) => !SKIP.has(t));
}

// Reads every table inside one transaction so the copy is a consistent snapshot.
export async function dumpTables(db: Db): Promise<Record<string, unknown[]>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read read only`);
    const out: Record<string, unknown[]> = {};
    for (const t of await tableNames(tx as unknown as Db)) {
      const rows = await tx.execute<{ r: unknown }>(sql`select to_jsonb(x) as r from ${sql.identifier(t)} x`);
      out[t] = [...rows].map((r) => r.r);
    }
    return out;
  });
}

// Replaces the contents of every table in the dump. Tables are cleared first, then filled with
// the saved rows; the generated id sequences are moved past the restored ids.
export async function restoreTables(db: Db, tables: Record<string, unknown[]>): Promise<void> {
  await db.transaction(async (tx) => {
    const names = (await tableNames(tx as unknown as Db)).filter((t) => t in tables);
    if (!names.length) throw new Error("backup has no tables that exist here");
    await tx.execute(sql`truncate ${sql.join(names.map((t) => sql.identifier(t)), sql`, `)} restart identity cascade`);
    for (const t of names) {
      const rows = tables[t];
      if (!rows?.length) continue;
      await tx.execute(sql`insert into ${sql.identifier(t)} select * from jsonb_populate_recordset(null::${sql.identifier(t)}, ${JSON.stringify(rows)}::jsonb)`);
      const seq = await tx.execute<{ s: string | null }>(sql`select pg_get_serial_sequence(${"public." + t}, 'id') as s`);
      const s = [...seq][0]?.s;
      if (s) await tx.execute(sql`select setval(${s}, greatest((select coalesce(max(id), 0) from ${sql.identifier(t)}), 1))`);
    }
  });
}
