import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

// Personal Microsoft accounts only ("consumers"), so work and school accounts cannot be linked.
const AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
export const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = "offline_access Calendars.Read User.Read";

export const OAUTH_COOKIE = "ls_oauth";
export const OAUTH_COOKIE_PATH = "/api/connections/outlook";

// In production APP_URL is required, so the redirect address never depends on request headers.
export const microsoftConfigured = () =>
  !!process.env.MICROSOFT_CLIENT_ID &&
  !!process.env.MICROSOFT_CLIENT_SECRET &&
  (process.env.NODE_ENV !== "production" || !!process.env.APP_URL);

// APP_URL pins the address Microsoft redirects back to; it must match the registered one exactly.
export const appOrigin = (fallback: string) => (process.env.APP_URL || fallback).replace(/\/$/, "");
const redirectUri = (origin: string) => `${origin}${OAUTH_COOKIE_PATH}/callback`;

export function newPkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeUrl(origin: string, state: string, challenge: string): string {
  const u = new URL(`${AUTHORITY}/authorize`);
  u.search = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri(origin),
    response_mode: "query",
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return u.toString();
}

export class TokenError extends Error {
  constructor(public code: string) {
    super(`token request failed: ${code}`);
  }
}

const Tokens = z.object({ access_token: z.string(), refresh_token: z.string().optional() });

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      scope: SCOPES,
      ...params,
    }),
    cache: "no-store",
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new TokenError(String((json as { error?: string }).error ?? res.status));
  return Tokens.parse(json);
}

export const exchangeCode = (origin: string, code: string, verifier: string) =>
  tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri(origin) });

export const refreshTokens = (refreshToken: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

// Only ever sends the access token to Microsoft Graph, including when following paging links.
export async function graphGet(url: string, accessToken: string): Promise<unknown> {
  if (new URL(url).origin !== "https://graph.microsoft.com") throw new Error("refusing non-Graph URL");
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, prefer: 'outlook.timezone="UTC", IdType="ImmutableId"' },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`graph request failed: ${res.status}`);
  return res.json();
}
