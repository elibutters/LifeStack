import "server-only";
import { z } from "zod";
import { NOTION_VERSION } from "./notion-core";

// Notion OAuth for a public integration with the read-content capability only. Access tokens are short-lived and a refresh
// replaces both tokens, so callers always store the newest pair. Tokens are only ever sent to api.notion.com.
export const NOTION_API = "https://api.notion.com";
export const OAUTH_COOKIE = "ls_notion";
export const OAUTH_COOKIE_PATH = "/api/connections/notion";

export const notionConfigured = () =>
  !!process.env.NOTION_CLIENT_ID && !!process.env.NOTION_CLIENT_SECRET && !!process.env.ENCRYPTION_KEY && (process.env.NODE_ENV !== "production" || !!process.env.APP_URL);

export const appOrigin = (fallback: string) => (process.env.APP_URL || fallback).replace(/\/$/, "");
const redirectUri = (origin: string) => `${origin}${OAUTH_COOKIE_PATH}/callback`;

export function authorizeUrl(origin: string, state: string): string {
  const u = new URL(`${NOTION_API}/v1/oauth/authorize`);
  u.search = new URLSearchParams({ client_id: process.env.NOTION_CLIENT_ID!, response_type: "code", owner: "user", redirect_uri: redirectUri(origin), state }).toString();
  return u.toString();
}

export class NotionError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`notion request failed: ${status} ${code}`);
  }
  get invalidGrant() { return this.code === "invalid_grant"; }
}

const Tokens = z.object({ access_token: z.string(), refresh_token: z.string(), workspace_name: z.string().nullish() });
export type OAuthResult = { access: string; refresh: string; workspace: string | null };

async function tokenRequest(body: Record<string, string>): Promise<OAuthResult> {
  const basic = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${NOTION_API}/v1/oauth/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/json", "notion-version": NOTION_VERSION },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new NotionError(res.status, String((json as { error?: string }).error ?? res.status));
  const t = Tokens.parse(json);
  return { access: t.access_token, refresh: t.refresh_token, workspace: t.workspace_name ?? null };
}

export const exchangeCode = (origin: string, code: string) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin) });
export const refreshTokens = (refresh: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
