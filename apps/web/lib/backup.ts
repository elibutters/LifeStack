import "server-only";
import { del, list, put } from "@vercel/blob";
import { db } from "@/lib/db";
import { backupName, expired, packBackup } from "@/lib/backup-core";
import { dumpTables } from "@/lib/backup-db";

const KEEP = 30;

export async function runBackup(now = new Date()) {
  const tables = await dumpTables(db());
  const body = packBackup(tables, process.env.ENCRYPTION_KEY ?? "", now);
  const name = backupName(now);
  await put(name, body, { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/octet-stream" });
  const all = await list({ prefix: "backups/" });
  const old = expired(all.blobs.map((b) => b.pathname), KEEP);
  if (old.length) await del(all.blobs.filter((b) => old.includes(b.pathname)).map((b) => b.url));
  return { name, bytes: body.length, rows: Object.values(tables).reduce((n, t) => n + t.length, 0), pruned: old.length };
}
