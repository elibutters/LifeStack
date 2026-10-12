// Strava: OAuth, activity mapping, sync, live-update events and the activities API. Strava is mocked; nothing leaves
// the machine. Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) { console.error("refusing to run: not the test database"); process.exit(2); }
Object.assign(process.env, { STRAVA_CLIENT_ID: "cid", STRAVA_CLIENT_SECRET: "csecret", ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.example" });
const map = await import("../lib/strava-map.ts"); const st = await import("../lib/strava.ts"); const sync = await import("../lib/strava-sync.ts"); const hook = await import("../lib/strava-webhook.ts");
const acts = await import("../lib/activities.ts"); const api = await import("../lib/app-api.ts"); const tok = await import("../lib/tokens.ts");
const { db } = await import("../lib/db.ts"); const { events, connections, syncState, apiTokens } = await import("@lifestack/db"); const { eq } = await import("drizzle-orm"); const { decrypt } = await import("../lib/crypto.ts");

// ---- mock Strava
type Call = { url: string; method: string; auth: string | null; body: string };
const calls: Call[] = []; let list: any[] = []; let listStatus = 200; let tokenStatus = 200; let rotation = 0; let subs: any[] = [];
const act = (id: number, daysAgo: number, extra: Record<string, unknown> = {}) => ({ id, name: `Run ${id}`, sport_type: "Run", type: "Run", start_date: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), distance: 5000 + id, moving_time: 1500, elapsed_time: 1600, total_elevation_gain: 40, average_heartrate: 150, suffer_score: 55, ...extra });
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; const u = new URL(url);
  const call: Call = { url, method: init.method ?? "GET", auth: new Headers(init.headers ?? {}).get("authorization"), body: String(init.body ?? "") }; calls.push(call);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (u.pathname === "/oauth/token") {
    if (tokenStatus !== 200) return json({ message: tokenStatus === 400 ? "invalid_grant" : "x" }, tokenStatus);
    const body = new URLSearchParams(call.body); rotation++;
    return json({ access_token: `at-${rotation}`, refresh_token: `rt-${rotation}`, expires_at: 0, ...(body.get("grant_type") === "authorization_code" ? { athlete: { id: 42, firstname: "Pat", lastname: "Runner" } } : {}) });
  }
  if (u.pathname === "/api/v3/athlete/activities") {
    if (listStatus !== 200) return json({ message: "x" }, listStatus);
    const after = Number(u.searchParams.get("after")); const page = Number(u.searchParams.get("page")); const per = Number(u.searchParams.get("per_page"));
    const rows = list.filter((a) => Date.parse(a.start_date) / 1000 > after);
    return json(rows.slice((page - 1) * per, page * per));
  }
  if (u.pathname === "/api/v3/push_subscriptions") { if (call.method === "POST") { subs.push({ id: 1, callback_url: new URLSearchParams(call.body).get("callback_url") }); return json({ id: 1 }, 201); } return json(subs); }
  return json({ message: "unexpected " + url }, 500);
}) as typeof fetch;
const reset = async () => { calls.length = 0; list = []; listStatus = 200; tokenStatus = 200; subs = []; await db().delete(events); await db().delete(connections); await db().delete(syncState); await db().delete(apiTokens); };
const stored = () => db().select().from(events).where(eq(events.source, "strava"));
await reset();

// ---- mapping
const m = map.toRow(act(7, 1));
assert.equal(m.kind, "row"); if (m.kind !== "row") throw 0;
assert.deepEqual([m.row.domain, m.row.key, m.row.source, m.row.sourceId, m.row.valueText, m.row.valueNum], ["activity", "activity.workout", "strava", "act:7", "Run", 1500]);
assert.equal(m.row.payload.distanceM, 5007); assert.equal(m.row.payload.effort, 55); assert.ok(!("calories" in m.row.payload), "missing fields are left out, not stored as null");
assert.equal(map.toRow({ id: 9, start_date: "not a date" }).kind, "invalid"); assert.deepEqual(map.toRow({ id: 9 }), { kind: "invalid", id: 9 }); assert.deepEqual(map.toRow(null), { kind: "invalid", id: undefined });
assert.ok(!JSON.stringify(m.row).includes("latlng") && !JSON.stringify(m.row).includes("polyline"), "no GPS is stored");

// ---- OAuth
const url = new URL(st.authorizeUrl("https://app.example", "state123"));
assert.equal(url.origin + url.pathname, "https://www.strava.com/oauth/authorize"); assert.equal(url.searchParams.get("redirect_uri"), "https://app.example/api/connections/strava/callback"); assert.equal(url.searchParams.get("state"), "state123"); assert.ok(url.searchParams.get("scope")!.includes("activity:read_all"));
assert.match(st.webhookToken(), /^[0-9a-f]{32}$/); assert.equal(st.webhookToken(), st.webhookToken());
const t0 = await st.exchangeCode("code1"); assert.equal(t0.athlete?.id, 42); assert.equal(new URLSearchParams(calls.at(-1)!.body).get("client_secret"), "csecret");
assert.equal(st.stravaConfigured(), true); delete process.env.STRAVA_CLIENT_ID; assert.equal(st.stravaConfigured(), false); process.env.STRAVA_CLIENT_ID = "cid";

// ---- connect and first sync
assert.equal(await sync.syncStrava(), null, "nothing to sync before connecting");
await sync.saveConnection("rt-start", "Pat R.", 42);
const raw = (await db().select().from(connections))[0]!; assert.ok(!raw.refreshTokenEnc.includes("rt-start"), "the refresh token is stored encrypted"); assert.equal(decrypt(raw.refreshTokenEnc), "rt-start");
list = [act(1, 1), act(2, 3), act(3, 20)];
let r = await sync.syncStrava(); assert.deepEqual(r, { activities: 3 }); assert.equal((await stored()).length, 3);
const listCall = calls.filter((c) => c.url.includes("/athlete/activities")).at(-1)!; assert.match(listCall.auth!, /^Bearer at-\d+$/); assert.equal(new URL(listCall.url).searchParams.get("after"), "0", "the first sync reads the whole history");
assert.equal(decrypt((await db().select().from(connections))[0]!.refreshTokenEnc), `rt-${rotation}`, "the rotated refresh token is stored");
assert.ok((await sync.getSyncState())!.lastOkAt && (await sync.getSyncState())!.lastError === null); assert.equal(await sync.stravaActivityCount(), 3);

// ---- re-sync: no duplicates, edits update, deletions inside the window disappear, old ones stay
list = [act(1, 1, { name: "Renamed" }), act(2, 3)]; // 3 (20 days ago) is outside the two-week window; 2 still inside
r = await sync.syncStrava(); assert.deepEqual(r, { activities: 2 });
const rows2 = await stored(); assert.equal(rows2.length, 3, "an old activity outside the window is kept");
assert.equal((rows2.find((x) => x.sourceId === "act:1")!.payload as any).name, "Renamed", "edits are picked up");
list = [act(1, 1, { name: "Renamed" })]; await sync.syncStrava();
assert.deepEqual((await stored()).map((x) => x.sourceId).sort(), ["act:1", "act:3"], "an activity deleted on Strava disappears");
assert.equal(new URL(calls.filter((c) => c.url.includes("/athlete/activities")).at(-1)!.url).searchParams.get("after") !== "0", true, "later syncs read only recent activities");

// ---- an activity that cannot be read is left alone, not deleted
list = [act(1, 1), { id: 3, start_date: "garbage" }]; await sync.syncStrava(); assert.ok((await stored()).some((x) => x.sourceId === "act:3"));

// ---- paging
await reset(); await sync.saveConnection("rt-start", "Pat R.", 42); list = Array.from({ length: 450 }, (_, i) => act(1000 + i, 1 + (i % 300) / 100));
r = await sync.syncStrava({ full: true }); assert.deepEqual(r, { activities: 450 }); assert.equal((await stored()).length, 450); assert.equal(calls.filter((c) => c.url.includes("/athlete/activities")).length, 3, "three pages of up to 200");

// ---- an empty answer does not wipe a populated copy
list = []; await sync.syncStrava(); assert.equal((await stored()).length, 450); assert.match((await sync.getSyncState())!.lastError ?? "", /kept/);

// ---- failures are recorded and rethrown
await reset(); await sync.saveConnection("rt-start", "Pat R.", 42); list = [act(1, 1)];
listStatus = 429; await assert.rejects(() => sync.syncStrava()); assert.match((await sync.getSyncState())!.lastError ?? "", /rate limit/i);
listStatus = 200; tokenStatus = 400; await assert.rejects(() => sync.syncStrava()); assert.match((await sync.getSyncState())!.lastError ?? "", /Reconnect Strava/);
tokenStatus = 200; assert.deepEqual(await (async () => { await db().update(syncState).set({ leaseUntil: new Date(Date.now() + 60_000) }); return sync.syncStrava(); })(), { skipped: true }, "two syncs never overlap");
await db().update(syncState).set({ leaseUntil: null });

// ---- live-update events
await reset(); await sync.saveConnection("rt-start", "Pat R.", 42); list = [act(1, 1)];
assert.equal(await sync.handleStravaEvent({ object_type: "activity", aspect_type: "create", owner_id: 999 }), "ignored", "an event for another athlete is ignored"); assert.equal((await stored()).length, 0);
assert.equal(await sync.handleStravaEvent({ object_type: "activity", aspect_type: "create", owner_id: 42 }), "sync"); assert.equal((await stored()).length, 1, "a matching event syncs");
assert.equal(await sync.handleStravaEvent({ object_type: "activity", aspect_type: "update", owner_id: 42 }), "ignored", "a burst of events is one sync");
assert.equal(await sync.handleStravaEvent({ object_type: "athlete", aspect_type: "update", owner_id: 7, updates: { authorized: "false" } }), "ignored", "a forged deauthorisation for someone else does nothing"); assert.ok(await sync.getConnection());
assert.equal(await sync.handleStravaEvent({ object_type: "athlete", aspect_type: "update", owner_id: 42, updates: { authorized: "false" } }), "disconnected"); assert.equal(await sync.getConnection(), null); assert.equal((await stored()).length, 0, "revoking on Strava removes the data here");
assert.equal(await sync.handleStravaEvent({ object_type: "activity", owner_id: 42 }), "ignored", "no connection, nothing to do");

// ---- reading event bodies
const read = (body: string) => hook.readEvent(new Request("https://app.example/api/webhooks/strava", { method: "POST", body }));
const good = await read(JSON.stringify({ object_type: "activity", aspect_type: "create", owner_id: 42 })); assert.ok(good.ok && good.event.owner_id === 42);
const junk = await read("not json"); assert.ok(!junk.ok && junk.res.status === 400); const big = await read("x".repeat(5000)); assert.ok(!big.ok && big.res.status === 413); const arr = await read("null"); assert.ok(!arr.ok);

// ---- the webhook address check and registration
const verify = (qs: string) => hook.verifyChallenge(new Request("https://app.example/api/webhooks/strava?" + qs));
assert.equal((await verify("hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc")).status, 403); assert.equal((await verify("hub.mode=subscribe&hub.verify_token=" + st.webhookToken())).status, 403, "a challenge is required");
const ok = await verify(`hub.mode=subscribe&hub.verify_token=${st.webhookToken()}&hub.challenge=abc123`); assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { "hub.challenge": "abc123" });
assert.equal(await sync.ensureWebhook("http://localhost:3000"), "skipped"); assert.equal(await sync.ensureWebhook("https://localhost"), "skipped");
subs = []; assert.equal(await sync.ensureWebhook("https://app.example"), "created"); assert.equal(subs[0].callback_url, "https://app.example/api/webhooks/strava"); assert.equal(new URLSearchParams(calls.filter((c) => c.method === "POST" && c.url.includes("push_subscriptions")).at(-1)!.body).get("verify_token"), st.webhookToken());
assert.equal(await sync.ensureWebhook("https://app.example"), "ok", "registering twice does nothing"); subs = [{ id: 5, callback_url: "https://elsewhere.example/hook" }]; assert.equal(await sync.ensureWebhook("https://app.example"), "other", "never replaces another deployment's subscription");

// ---- reading activities through the API
await reset(); await sync.saveConnection("rt-start", "Pat R.", 42);
list = [act(1, 1), act(2, 2, { sport_type: "Ride", type: "Ride", distance: 20000, moving_time: 3600 }), act(3, 30)]; await sync.syncStrava({ full: true });
const reader = (await tok.createToken("fit", "agent", ["fitness:read"])).token; const noFit = (await tok.createToken("cal", "agent", ["calendar:read"])).token;
const get = (token: string | null, q = "") => api.handleActivities(new Request("http://x/api/v1/activities" + q, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
assert.equal((await get(null)).status, 401); assert.equal((await get(noFit)).status, 403, "a key without fitness:read cannot read workouts");
const all = (await (await get(reader)).json()) as any; assert.equal(all.activities.length, 3); assert.equal(all.activities[0].id, 1, "newest first"); assert.equal(all.totals.count, 3); assert.deepEqual(all.totals.bySport.map((x: any) => x.sport).sort(), ["Ride", "Run"]);
assert.equal(all.totals.distanceM, 5001 + 20000 + 5003); assert.ok(!JSON.stringify(all).includes("polyline"));
assert.equal(((await (await get(reader, "?sport=Ride")).json()) as any).activities.length, 1); assert.equal(((await (await get(reader, "?limit=1")).json()) as any).activities.length, 1);
const from = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10); assert.equal(((await (await get(reader, `?from=${from}`)).json()) as any).activities.length, 2, "date filter");
for (const bad of ["?from=nope", "?limit=0", "?limit=999", "?from=2026-05-02&to=2026-05-01"]) assert.equal((await get(reader, bad)).status, 400, bad);
assert.equal((await acts.loadActivities({ limit: 2 })).length, 2);

await reset();
console.log("STRAVA OK"); process.exit(0);
