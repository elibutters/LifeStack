// Owner profile: validation, compact JSON for agents, save/load and GET /api/v1/profile.
// Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) {
  console.error("refusing to run: not the test database");
  process.exit(2);
}
process.env.APP_TZ = "UTC";
const core = await import("../lib/profile-core.ts");
const prof = await import("../lib/profile.ts");
const tok = await import("../lib/tokens.ts");
const { db } = await import("../lib/db.ts");
const { ownerProfile, apiTokens } = await import("@lifestack/db");

// ---- parsing
const ok = (v: unknown) => core.parseProfile(v);
assert.deepEqual(ok({ preferredName: "  Example  ", legalName: "", extra: 1 }).ok && (ok({ preferredName: "  Example  ", extra: 1 }) as any).profile, { preferredName: "Example" });
assert.equal(ok({ dateOfBirth: "1990-06-15" }).ok, true);
assert.equal(ok({ dateOfBirth: "not-a-day" }).ok, false);
assert.equal(ok({ dateOfBirth: "1899-01-01" }).ok, false);
assert.equal(ok({ heightCm: "180.5" }).ok && (ok({ heightCm: "180.5" }) as any).profile.heightCm, 180.5);
assert.equal(ok({ heightCm: 10 }).ok, false);
assert.equal(ok({ bloodType: "O+" }).ok, true);
assert.equal(ok({ bloodType: "Z+" }).ok, false);
assert.equal(ok({ dominantHand: "left" }).ok, true);
assert.equal(core.ageYears("1990-10-04", "2026-10-04"), 36);
assert.equal(core.ageYears("1990-10-05", "2026-10-04"), 35);
assert.equal(core.ageYears(undefined, "2026-10-04"), null);
const pub = core.publicProfile({ preferredName: "Example Person", dateOfBirth: "1990-01-15" }, { timezone: "UTC", ageYears: 36 });
assert.equal(pub.preferredName, "Example Person");
assert.equal(pub.timezone, "UTC");
assert.equal(pub.ageYears, 36);
assert.ok(!("legalName" in pub));

// ---- database
await db().delete(ownerProfile);
await db().delete(apiTokens);
assert.deepEqual(await prof.loadProfile(), {});
const saved = await prof.saveProfileData({ preferredName: "Example Person", city: "Example City", heightCm: "175", goals: "  stay well  ", avoid: "" });
assert.equal(saved.ok, true);
assert.deepEqual((saved as any).profile, { preferredName: "Example Person", city: "Example City", heightCm: 175, goals: "stay well" });
assert.deepEqual(await prof.loadProfile(), (saved as any).profile);
const empty = await prof.saveProfileData({ preferredName: "   " });
assert.equal(empty.ok, true);
assert.deepEqual((empty as any).profile, {});

const writer = (await tok.createToken("writer", "shortcut", ["log:write"])).token;
const reader = (await tok.createToken("reader", "widget", ["log:read"])).token;
const call = (token: string | null) => prof.handleGetProfile(new Request("http://localhost/api/v1/profile", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
assert.equal((await call(null)).status, 401);
assert.equal((await call(writer)).status, 403);
await prof.saveProfileData({ preferredName: "Example Person", dateOfBirth: "1990-01-15" });
const res = await call(reader);
assert.equal(res.status, 200);
assert.equal(res.headers.get("cache-control"), "no-store");
const body = (await res.json()) as { preferredName: string; ageYears: number; timezone: string };
assert.equal(body.preferredName, "Example Person");
assert.equal(body.timezone, "UTC");
assert.equal(typeof body.ageYears, "number");
assert.ok(!JSON.stringify(body).includes("writer"));

await db().delete(ownerProfile);
await db().delete(apiTokens);
console.log("PROFILE OK");
process.exit(0);
