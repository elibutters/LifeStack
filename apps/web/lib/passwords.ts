import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt with a random salt per password. Stored as "scrypt$N$salt$hash" so the cost can change later.
const N = 16384;
const KEYLEN = 64;
const derive = (password: string, salt: Buffer, n: number) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${N}$${salt.toString("base64")}$${(await derive(password, salt, N)).toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await derive(password, Buffer.from(salt, "base64"), Number(n));
  return got.length === want.length && timingSafeEqual(got, want);
}

// Work to do when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY = hashPassword("not a real password");
export async function burnTime(password: string): Promise<void> {
  await verifyPassword(password, await DUMMY);
}
