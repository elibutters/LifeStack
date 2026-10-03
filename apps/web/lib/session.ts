// Single-owner session: an expiry timestamp signed with HMAC-SHA256.
// Web Crypto only, so it works in the proxy and in server code.
export const SESSION_COOKIE = "ls_session";
export const SESSION_TTL_S = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

// The signing key includes the password, so changing APP_PASSWORD signs everyone out.
// Rotating SESSION_SECRET does the same. Returns null (deny everything) if either is
// missing or too short to be safe on the public internet.
export function sessionKey(): string | null {
  const password = process.env.APP_PASSWORD ?? "";
  const secret = process.env.SESSION_SECRET ?? "";
  if (password.length < 16 || secret.length < 32) return null;
  return `${secret}\0${password}`;
}

async function hmac(key: string, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// Compares digests rather than inputs so timing does not depend on the secret.
export async function safeEqual(a: string, b: string, key: string): Promise<boolean> {
  const [x, y] = await Promise.all([hmac(key, a), hmac(key, b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export async function createSession(key: string): Promise<string> {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL_S);
  return `${exp}.${hex(await hmac(key, exp))}`;
}

export async function verifySession(token: string | undefined, key: string): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  const [exp, sig] = parts;
  if (parts.length !== 2 || !exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, hex(await hmac(key, exp)), key);
}
