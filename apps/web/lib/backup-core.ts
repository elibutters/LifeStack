import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

// A backup is every table as JSON, gzipped, then AES-256-GCM encrypted. The key is derived from
// ENCRYPTION_KEY with a separate label so it is never the same key that protects stored tokens.
// Layout: "LSBK1" | iv (12) | auth tag (16) | ciphertext.
const MAGIC = Buffer.from("LSBK1");

export type Dump = { version: 1; createdAt: string; tables: Record<string, unknown[]> };

function key(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("ENCRYPTION_KEY must be 64 hex characters");
  return Buffer.from(hkdfSync("sha256", Buffer.from(hex, "hex"), Buffer.alloc(0), "lifestack-backup-v1", 32));
}

export function packBackup(tables: Record<string, unknown[]>, keyHex: string, now = new Date()): Buffer {
  const dump: Dump = { version: 1, createdAt: now.toISOString(), tables };
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(keyHex), iv);
  const body = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(dump)))), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function unpackBackup(buf: Buffer, keyHex: string): Dump {
  if (buf.length < MAGIC.length + 28 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not a Life Stack backup");
  const iv = buf.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = buf.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const d = createDecipheriv("aes-256-gcm", key(keyHex), iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(buf.subarray(MAGIC.length + 28)), d.final()]);
  const dump = JSON.parse(gunzipSync(plain).toString("utf8")) as Dump;
  if (dump.version !== 1 || typeof dump.tables !== "object") throw new Error("unsupported backup version");
  return dump;
}

// Daily files named by date; keeps the newest `keep`.
export const backupName = (d: Date) => `backups/lifestack-${d.toISOString().slice(0, 10)}.bin`;
export function expired(names: string[], keep: number): string[] {
  return names.filter((n) => /^backups\/lifestack-\d{4}-\d{2}-\d{2}\.bin$/.test(n)).sort().reverse().slice(keep);
}
