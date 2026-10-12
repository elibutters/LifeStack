import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";

// Strava OAuth and API access. Tokens last six hours and the refresh token can change on every refresh, so callers
// always store the newest one. Only ever sends a token to strava.com.
const OAUTH = "https://www.strava.com/oauth";
const API = "https://www.strava.com/api/v3";
const SCOPE = "read,activity:read_all,profile:read_all";

export const OAUTH_COOKIE = "ls_strava";
export const OAUTH_COOKIE_PATH = "/api/connections/strava";

export const stravaConfigured = () =>
  !!process.env.STRAVA_CLIENT_ID && !!process.env.STRAVA_CLIENT_SECRET && (process.env.NODE_ENV !== "production" || !!process.env.APP_URL);

export const appOrigin = (fallback: string) => (process.env.APP_URL || fallback).replace(/\/$/, "");
const redirectUri = (origin: string) => `${origin}${OAUTH_COOKIE_PATH}/callback`;
export const webhookUrl = (origin: string) => `${origin}/api/webhooks/strava`;

// Derived from the encryption key, so the webhook needs no extra secret to configure.
export const webhookToken = () => createHmac("sha256", process.env.ENCRYPTION_KEY ?? "").update("strava-webhook-v1").digest("hex").slice(0, 32);

export function authorizeUrl(origin: string, state: string): string {
  const u = new URL(`${OAUTH}/authorize`);
  u.search = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri(origin),
    approval_prompt: "auto",
    scope: SCOPE,
    state,
  }).toString();
  return u.toString();
}

export class StravaError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`strava request failed: ${status} ${code}`);
  }
  get rateLimited() { return this.status === 429; }
  get notFound() { return this.status === 404; }
  get unauthorized() { return this.status === 401 || this.code === "invalid_grant"; }
}

const Tokens = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.number().optional(),
  athlete: z.object({ id: z.number(), firstname: z.string().nullish(), lastname: z.string().nullish() }).optional(),
});
export type StravaTokens = z.infer<typeof Tokens>;

async function tokenRequest(params: Record<string, string>): Promise<StravaTokens> {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID!, client_secret: process.env.STRAVA_CLIENT_SECRET!, ...params }),
    cache: "no-store",
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new StravaError(res.status, String((json as { message?: string }).message ?? res.status));
  return Tokens.parse(json);
}

export const exchangeCode = (code: string) => tokenRequest({ grant_type: "authorization_code", code });
export const refreshTokens = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

export async function stravaGet(path: string, accessToken: string, query: Record<string, string | number> = {}): Promise<unknown> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  if (url.origin !== "https://www.strava.com") throw new Error("refusing non-Strava URL");
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new StravaError(res.status, res.statusText || String(res.status));
  return res.json();
}

// ---- push subscriptions (one per Strava application)
const Subs = z.array(z.object({ id: z.number(), callback_url: z.string() }));

export async function listSubscriptions() {
  const u = new URL(`${API}/push_subscriptions`);
  u.search = new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID!, client_secret: process.env.STRAVA_CLIENT_SECRET! }).toString();
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new StravaError(res.status, "list subscriptions");
  return Subs.parse(await res.json());
}

export async function createSubscription(origin: string) {
  const res = await fetch(`${API}/push_subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      callback_url: webhookUrl(origin),
      verify_token: webhookToken(),
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new StravaError(res.status, "create subscription");
}
