import "server-only";
import { eq } from "drizzle-orm";
import { ownerProfile } from "@lifestack/db";
import { db } from "./db";
import { describeError } from "./errors";
import { TZ, todayInTz } from "./dates";
import { ageYears, compactProfile, parseProfile, publicProfile, type Profile } from "./profile-core";
import { verifyBearer } from "./tokens";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function loadProfile(): Promise<Profile> {
  const [row] = await db().select().from(ownerProfile).where(eq(ownerProfile.id, 1));
  if (!row) return {};
  const parsed = parseProfile(row.payload);
  return parsed.ok ? parsed.profile : {};
}

export async function saveProfileData(raw: unknown): Promise<{ ok: true; profile: Profile } | { ok: false; issues: { path: string; message: string }[] }> {
  const parsed = parseProfile(raw);
  if (!parsed.ok) return parsed;
  const profile = compactProfile(parsed.profile);
  await db()
    .insert(ownerProfile)
    .values({ id: 1, payload: profile as Record<string, unknown>, updatedAt: new Date() })
    .onConflictDoUpdate({ target: ownerProfile.id, set: { payload: profile as Record<string, unknown>, updatedAt: new Date() } });
  return { ok: true, profile };
}

export function profileForAgents(profile: Profile, now = new Date()) {
  return publicProfile(profile, { timezone: TZ, ageYears: ageYears(profile.dateOfBirth, todayInTz(now)) });
}

export async function handleGetProfile(req: Request): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), "log:read");
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  try {
    return json(profileForAgents(await loadProfile()));
  } catch (e) {
    console.error("profile: could not read", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}
