// Location: point validation, distances, place matching, stays, storage and the bearer-protected API.
// Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
const core = await import("../lib/location-core.ts");
const loc = await import("../lib/location.ts");
const tok = await import("../lib/tokens.ts");
const cap = await import("../lib/capture-core.ts");
const { db } = await import("../lib/db.ts");
const { locationPoints, places, apiTokens } = await import("@lifestack/db");

// ---- rules
const pt = (o: Record<string, unknown> = {}) => ({ id: "abcdefgh1", at: "2026-10-12T12:00:00Z", lat: 40.7, lon: -74, source: "significant", ...o });
assert.equal(core.PointInput.safeParse(pt()).success, true);
assert.equal(core.PointInput.safeParse(pt({ lat: 91 })).success, false);
assert.equal(core.PointInput.safeParse(pt({ lon: -181 })).success, false);
assert.equal(core.PointInput.safeParse(pt({ id: "short" })).success, false);
assert.equal(core.PointInput.safeParse(pt({ source: "gps" })).success, false);
assert.equal(core.PointInput.safeParse(pt({ at: "yesterday" })).success, false);
assert.equal(core.BatchInput.safeParse({ points: [] }).success, false);
assert.equal(core.BatchInput.safeParse({ points: Array.from({ length: 201 }, (_, i) => pt({ id: `id-${String(i).padStart(6, "0")}` })) }).success, false);
const now = new Date("2026-10-12T12:00:00Z");
assert.equal(core.notTooFuture("2026-10-13T11:00:00Z", now), true);
assert.equal(core.notTooFuture("2026-10-14T12:00:00Z", now), false);
assert.ok(Math.abs(core.distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111_195) < 200, "one degree of longitude at the equator");
assert.equal(core.distanceM({ lat: 40, lon: -74 }, { lat: 40, lon: -74 }), 0);
const home = { id: 1, label: "Home", lat: 40.7, lon: -74, radiusM: 100 }, gym = { id: 2, label: "Gym", lat: 40.7, lon: -74.001, radiusM: 100 };
assert.equal(core.placeAt({ lat: 40.7001, lon: -74 }, [home, gym])?.label, "Home");
assert.equal(core.placeAt({ lat: 40.7, lon: -74.0009 }, [home, gym])?.label, "Gym", "the closer place wins");
assert.equal(core.placeAt({ lat: 41, lon: -74 }, [home, gym]), null);
const P = (iso: string, source: string, lat = 40.7, lon = -74) => ({ ts: new Date(iso), lat, lon, source });
const st = core.staysOf([P("2026-10-12T08:00:00Z", "visit-arrival"), P("2026-10-12T09:30:00Z", "visit-departure"), P("2026-10-12T10:00:00Z", "visit-arrival", 41, -74)], [home], new Date("2026-10-12T11:00:00Z"));
assert.deepEqual(st.map((s) => [s.place, s.minutes, s.to === null]), [[null, 60, true], ["Home", 90, false]], "newest first; no departure means ongoing");
assert.equal(core.staysOf([P("2026-10-12T08:00:00Z", "visit-arrival"), P("2026-10-12T09:00:00Z", "visit-departure", 41, -74)], [], now)[0]!.to, null, "a departure far away is not this stay's");

// ---- storage and API
await db().delete(locationPoints); await db().delete(places); await db().delete(apiTokens);
const body = (extra: Record<string, unknown>[]) => ({ points: extra.map((e, i) => pt({ id: `batch-id-${i}`, ...e })) });
let r = await loc.storePoints(body([{}, { id: "batch-id-x1", at: "2026-10-12T13:00:00Z" }]), now); assert.deepEqual(r, { ok: true, received: 2, stored: 2 });
r = await loc.storePoints(body([{}]), now); assert.deepEqual(r, { ok: true, received: 1, stored: 0 }, "a retried upload stores nothing twice");
assert.equal((await loc.storePoints(body([{ at: "2030-01-01T00:00:00Z" }]), now)).ok, false);
assert.equal((await db().select().from(locationPoints)).length, 2);
const req = (method: string, path: string, key: string | null, b?: unknown) => new Request(`http://localhost/api/v1${path}`, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
const writer = await tok.createToken("w", "agent", ["location:write"]); const reader = await tok.createToken("r", "agent", ["location:read"]);
assert.equal((await loc.handleLocation(req("POST", "/location", null, body([{}])))).status, 401);
assert.equal((await loc.handleLocation(req("POST", "/location", reader.token, body([{}])))).status, 403);
assert.equal((await loc.handleLocation(req("POST", "/location", writer.token, { points: "x" }))).status, 400);
const up = await loc.handleLocation(req("POST", "/location", writer.token, body([{ id: "api-point-1", source: "visit-arrival", at: new Date().toISOString() }]))); assert.equal(up.status, 201);
assert.equal((await loc.handleLocation(req("GET", "/location", writer.token))).status, 403);
const hist = (await (await loc.handleLocation(req("GET", "/location?days=2", reader.token))).json()) as { stays: { place: string | null }[]; latest: { lat: number } | null };
assert.equal(hist.stays.length, 1); assert.equal(hist.latest?.lat, 40.7);
assert.equal((await loc.handleLocation(req("GET", "/location?days=0", reader.token))).status, 400);
const placed = await loc.handlePlaces(req("POST", "/places", writer.token, { label: "Home", lat: 40.7, lon: -74 })); assert.equal(placed.status, 201);
const pid = ((await placed.json()) as { id: number }).id;
assert.equal((await loc.handlePlaces(req("POST", "/places", writer.token, { label: "", lat: 0, lon: 0 }))).status, 400);
assert.equal(((await (await loc.handleLocation(req("GET", "/location", reader.token))).json()) as { stays: { place: string }[] }).stays[0]!.place, "Home");
assert.equal((await loc.handlePlace(req("DELETE", `/places/${pid}`, reader.token), String(pid))).status, 403);
assert.equal((await loc.handlePlace(req("DELETE", `/places/${pid}`, writer.token), String(pid))).status, 200);
assert.equal((await loc.handlePlace(req("DELETE", `/places/${pid}`, writer.token), String(pid))).status, 404);
assert.ok(cap.APP_SCOPES.includes("location:write") && !cap.APP_SCOPES.includes("email:read"), "the phone can upload location but not read mail");

await db().delete(locationPoints); await db().delete(places); await db().delete(apiTokens);
console.log("location: ok");
process.exit(0);
