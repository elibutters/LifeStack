import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// True when the browser says the request came from another site.
export function crossSite(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  return !!site && site !== "same-origin" && site !== "none";
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. /api/cron/* skips the session gate, so
// every handler there must call this and fail closed.
export function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 32) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}
