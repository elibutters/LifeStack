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
assert.deepEqual((ok({ name: "  Example  ", extra: 1 }) as any).profile, { firstName: "Example", name: "Example" });
assert.deepEqual((ok({ firstName: " Ada ", middleName: "", lastName: "Example" }) as any).profile, { firstName: "Ada", lastName: "Example", name: "Ada Example" });
assert.deepEqual((ok({ preferredName: "Example Person" }) as any).profile, { firstName: "Example", lastName: "Person", name: "Example Person" });
assert.deepEqual((ok({ name: "Ada Example Person" }) as any).profile, { firstName: "Ada", middleName: "Example", lastName: "Person", name: "Ada Example Person" });
assert.ok(!("pronouns" in ((ok({ pronouns: "they" }) as any).profile as object)));
assert.ok(!("gender" in ((ok({ gender: "x", sex: "female" }) as any).profile as object)));
assert.equal((ok({ sex: "female" }) as any).profile.sex, "female");
assert.equal(ok({ dateOfBirth: "1990-06-15" }).ok, true);
assert.equal(ok({ dateOfBirth: "not-a-day" }).ok, false);
assert.equal(ok({ dateOfBirth: "1899-01-01" }).ok, false);
assert.deepEqual((ok({ heightFt: "5", heightIn: "11" }) as any).profile, { heightFt: 5, heightIn: 11 });
assert.deepEqual((ok({ heightFt: 6 }) as any).profile, { heightFt: 6, heightIn: 0 });
assert.equal(ok({ heightFt: 9 }).ok, false);
assert.equal(ok({ heightFt: 1, heightIn: 0 }).ok, false);
assert.deepEqual((ok({ heightCm: "180.5" }) as any).profile, { heightFt: 5, heightIn: 11 });
assert.equal(ok({ heightCm: 10 }).ok, false);
assert.equal((ok({ weightLb: "180.5" }) as any).profile.weightLb, 180.5);
assert.equal(ok({ weightLb: 10 }).ok, false);
assert.equal((ok({ weightKg: "70" }) as any).profile.weightLb, 154.3);
assert.ok(!("diet" in ((ok({ diet: "plants", fitnessNotes: "run" }) as any).profile as object)));
assert.deepEqual((ok({ address1: " 1 Example St ", address2: "", city: "Example City", state: "NY", zip: "10001", pets: "none", contacts: [{ kind: "email", value: " a@example.com ", description: " Home " }, { kind: "phone", value: "  ", description: "skip" }, { kind: "username", value: "example", description: "" }] }) as any).profile, { address1: "1 Example St", city: "Example City", state: "NY", zip: "10001", contacts: [{ kind: "email", value: "a@example.com", description: "Home" }, { kind: "username", value: "example" }] });
assert.equal(ok({ contacts: [{ kind: "fax", value: "1" }] }).ok, false);
assert.equal(ok({ bloodType: "O+" }).ok, true);
assert.equal(ok({ bloodType: "Z+" }).ok, false);
assert.equal(ok({ dominantHand: "left" }).ok, true);
assert.equal(core.ageYears("1990-10-04", "2026-10-04"), 36);
assert.equal(core.ageYears("1990-10-05", "2026-10-04"), 35);
assert.equal(core.ageYears(undefined, "2026-10-04"), null);
const pub = core.publicProfile({ firstName: "Example", lastName: "Person", dateOfBirth: "1990-01-15" }, { timezone: "UTC", ageYears: 36 });
assert.equal(pub.name, "Example Person");
assert.equal(pub.firstName, "Example");
assert.equal(pub.timezone, "UTC");
assert.equal(pub.ageYears, 36);

// ---- database
await db().delete(ownerProfile);
await db().delete(apiTokens);
assert.deepEqual(await prof.loadProfile(), {});
const saved = await prof.saveProfileData({ firstName: "Example", lastName: "Person", city: "Example City", heightFt: "5", heightIn: "9", weightLb: "180", goals: "  stay well  ", avoid: "" });
assert.equal(saved.ok, true);
assert.deepEqual((saved as any).profile, { firstName: "Example", lastName: "Person", name: "Example Person", city: "Example City", heightFt: 5, heightIn: 9, weightLb: 180, goals: "stay well" });
assert.deepEqual(await prof.loadProfile(), (saved as any).profile);
const empty = await prof.saveProfileData({ firstName: "   " });
assert.equal(empty.ok, true);
assert.deepEqual((empty as any).profile, {});

const writer = (await tok.createToken("writer", "shortcut", ["log:write"])).token;
const reader = (await tok.createToken("reader", "widget", ["log:read"])).token;
const call = (token: string | null) => prof.handleGetProfile(new Request("http://localhost/api/v1/profile", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
assert.equal((await call(null)).status, 401);
assert.equal((await call(writer)).status, 403);
await prof.saveProfileData({ firstName: "Example", lastName: "Person", dateOfBirth: "1990-01-15" });
const res = await call(reader);
assert.equal(res.status, 200);
assert.equal(res.headers.get("cache-control"), "no-store");
const body = (await res.json()) as { name: string; ageYears: number; timezone: string };
assert.equal(body.name, "Example Person");
assert.equal(body.timezone, "UTC");
assert.equal(typeof body.ageYears, "number");
assert.ok(!JSON.stringify(body).includes("writer"));

await db().delete(ownerProfile);
await db().delete(apiTokens);
console.log("PROFILE OK");
process.exit(0);
