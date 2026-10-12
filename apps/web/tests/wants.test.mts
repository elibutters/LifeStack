// Wants list: validation, summary, storage and the bearer-protected API.
// Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) {
  console.error("refusing to run: not the test database");
  process.exit(2);
}
const core = await import("../lib/wants-core.ts");
const w = await import("../lib/wants.ts");
const tok = await import("../lib/tokens.ts");
const { db } = await import("../lib/db.ts");
const { wants, apiTokens } = await import("@lifestack/db");

// ---- validation
const p = (v: unknown) => core.WantInput.safeParse(v);
assert.equal(p({ title: "  Standing desk " }).data?.title, "Standing desk");
assert.equal(p({ title: "" }).success, false);
assert.equal(p({ title: "x", url: "javascript:alert(1)" }).success, false);
assert.equal(p({ title: "x", url: "https://example.com/a" }).data?.url, "https://example.com/a");
assert.equal(p({ title: "x", url: "" }).data?.url, null);
assert.equal(p({ title: "x", price: "$1,299.99" }).data?.price, 129999);
assert.equal(p({ title: "x", price: "" }).data?.price, null);
assert.equal(p({ title: "x", price: -1 }).success, false);
assert.equal(p({ title: "x", price: "abc" }).success, false);
assert.equal(core.WantPatch.safeParse({}).success, false);
assert.equal(core.WantPatch.safeParse({ status: "gone" }).success, false);
assert.equal(core.WantPatch.safeParse({ status: "bought" }).success, true);

// ---- summary
assert.deepEqual(
  core.summarize([
    { status: "want", priceCents: 1000 },
    { status: "want", priceCents: null },
    { status: "bought", priceCents: 500 },
  ]),
  { open: 2, bought: 1, openTotalCents: 1000, unpriced: 1 },
);
assert.equal(core.fmtCents(129999), "$1,299.99");
assert.equal(core.fmtCents(2000), "$20");

// ---- storage
await db().delete(wants);
const a = await w.addWant({ title: "Desk", price: 450 });
assert.ok(a.ok && a.want.priceCents === 45000 && a.want.status === "want");
assert.equal((await w.addWant({ title: "" })).ok, false);
const id = (a as { want: { id: number } }).want.id;
const u = await w.updateWant(id, { status: "bought", price: "" });
assert.ok(u.ok && u.want?.status === "bought" && u.want.priceCents === null);
assert.ok((await w.updateWant(999999, { status: "dropped" })).ok);
assert.equal(((await w.updateWant(999999, { status: "dropped" })) as { want: unknown }).want, null);

// ---- API
const req = (method: string, path: string, key: string | null, body?: unknown) =>
  new Request(`http://localhost/api/v1/wants${path}`, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const writer = await tok.createToken("w", "agent", ["log:write", "log:read"]);
const reader = await tok.createToken("r", "agent", ["log:read"]);
assert.equal((await w.handleWants(req("GET", "", null))).status, 401);
assert.equal((await w.handleWants(req("POST", "", reader.token, { title: "x" }))).status, 403);
const made = await w.handleWants(req("POST", "", writer.token, { title: "Lamp", url: "ftp://x" }));
assert.equal(made.status, 400);
const created = await w.handleWants(req("POST", "", writer.token, { title: "Lamp", price: 30 }));
assert.equal(created.status, 201);
const lampId = ((await created.json()) as { id: number }).id;
const list = (await (await w.handleWants(req("GET", "", reader.token))).json()) as { wants: { title: string }[] };
assert.ok(list.wants.some((x) => x.title === "Lamp"));
assert.equal((await w.handleWant(req("PATCH", `/${lampId}`, writer.token, { status: "dropped" }), String(lampId))).status, 200);
assert.equal((await w.handleWant(req("PATCH", `/${lampId}`, reader.token, { status: "want" }), String(lampId))).status, 403);
assert.equal((await w.handleWant(req("DELETE", `/${lampId}`, writer.token), String(lampId))).status, 200);
assert.equal((await w.handleWant(req("DELETE", `/${lampId}`, writer.token), String(lampId))).status, 404);
assert.equal((await w.handleWant(req("DELETE", `/abc`, writer.token), "abc")).status, 404);

await db().delete(wants);
await db().delete(apiTokens);
console.log("wants: ok");
process.exit(0);
