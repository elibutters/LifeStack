// Single-owner session: an expiry timestamp signed with HMAC-SHA256.
// Web Crypto only, so it works in the proxy and in server actions.
export const SESSION_COOKIE = "ls_session";
export const SESSION_TTL_S = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// Compares digests rather than inputs so timing does not depend on the secret.
export async function safeEqual(a: string, b: string, secret: string): Promise<boolean> {
  const [x, y] = await Promise.all([hmac(secret, a), hmac(secret, b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export async function createSession(secret: string): Promise<string> {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL_S);
  return `${exp}.${hex(await hmac(secret, exp))}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, hex(await hmac(secret, exp)), secret);
}
