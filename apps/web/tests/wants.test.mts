// Wants list: validation, options, choosing, and the bearer-protected API.
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
const { wants, wantOptions, apiTokens } = await import("@lifestack/db");

// ---- validation
const o = (v: unknown) => core.OptionInput.safeParse(v);
assert.equal(o({ title: "  Parka " }).data?.title, "Parka");
assert.equal(o({ title: "" }).success, false);
assert.equal(o({ title: "x", url: "javascript:alert(1)" }).success, false);
assert.equal(o({ title: "x", url: "" }).data?.url, null);
assert.equal(o({ title: "x", price: "$1,299.99" }).data?.price, 129999);
assert.equal(o({ title: "x", price: "" }).data?.price, null);
assert.equal(o({ title: "x", price: -1 }).success, false);
assert.equal(o({ title: "x", target: "abc" }).success, false);
assert.equal(core.WantInput.safeParse({ title: "Jacket", budget: 300 }).data?.budget, 30000);
assert.equal(core.WantPatch.safeParse({}).success, false);
assert.equal(core.WantPatch.safeParse({ status: "chosen" }).success, false);
assert.equal(core.OptionPatch.safeParse({ status: "chosen" }).success, true);
assert.equal(core.OptionPatch.safeParse({ status: "bought" }).success, false);

// ---- pure helpers
assert.equal(core.atTarget(9000, 10000), true);
assert.equal(core.atTarget(11000, 10000), false);
assert.equal(core.atTarget(null, 10000), false);
assert.equal(core.bestPrice([{ status: "considering", priceCents: 500 }, { status: "rejected", priceCents: 100 }, { status: "considering", priceCents: null }]), 500);
assert.equal(core.bestPrice([]), null);
assert.equal(core.fmtCents(129999), "$1,299.99");
assert.equal(core.fmtCents(2000), "$20");

// ---- storage
await db().delete(wants);
const single = await w.addWant({ title: "Desk lamp", first: { price: "30", target: "25" } });
assert.ok(single.ok);
const bare = await w.addWant({ title: "Jacket", note: "waterproof", budget: 300 });
assert.ok(bare.ok);
assert.equal((await w.addWant({ title: "" })).ok, false);
assert.equal((await w.addWant({ title: "x", first: { url: "ftp://x" } })).ok, false);
const jacketId = (bare as { id: number }).id;
const a = await w.addOption(jacketId, { title: "Parka A", price: 280, target: 250 });
const b = await w.addOption(jacketId, { title: "Parka B", price: 200, target: 220 });
assert.ok(a.ok && b.ok);
assert.equal((await w.addOption(999999, { title: "x" })).ok, false);
let list = await w.listWants();
let jacket = list.find((x) => x.id === jacketId)!;
assert.equal(jacket.options.length, 2);
assert.equal(jacket.bestPriceCents, 20000);
assert.equal(jacket.options.find((x) => x.title === "Parka B")!.atTarget, true);
assert.equal(jacket.options.find((x) => x.title === "Parka A")!.atTarget, false);
assert.equal(list.find((x) => x.title === "Desk lamp")!.options.length, 1);
assert.deepEqual(core.summarize(list), { open: 2, bought: 0, deals: 1 });

// a price update stamps the check time; a lower price can reach the target
const aId = (a as { id: number }).id, bId = (b as { id: number }).id;
await w.updateOption(aId, { price: 240 });
jacket = (await w.listWants()).find((x) => x.id === jacketId)!;
const pa = jacket.options.find((x) => x.id === aId)!;
assert.equal(pa.atTarget, true);
assert.ok(pa.priceCheckedAt);

// choosing one rejects the rest and buys the want; reopening restores it
await w.updateOption(bId, { status: "chosen" });
jacket = (await w.listWants()).find((x) => x.id === jacketId)!;
assert.equal(jacket.status, "bought");
assert.deepEqual(jacket.options.map((x) => x.status).sort(), ["chosen", "rejected"]);
assert.equal(jacket.bestPriceCents, 20000);
await w.updateWant(jacketId, { status: "want" });
jacket = (await w.listWants()).find((x) => x.id === jacketId)!;
assert.equal(jacket.status, "want");
assert.deepEqual(jacket.options.map((x) => x.status).sort(), ["considering", "rejected"]);

// deleting a want removes its options
assert.ok(await w.deleteWant(jacketId));
assert.equal((await db().select().from(wantOptions)).filter((x) => x.wantId === jacketId).length, 0);
assert.equal((await w.updateWant(999999, { status: "dropped" }) as { found: boolean }).found, false);

// ---- API
const req = (method: string, key: string | null, body?: unknown) =>
  new Request("http://localhost/api/v1/wants", { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const writer = await tok.createToken("w", "agent", ["log:write", "log:read"]);
const reader = await tok.createToken("r", "agent", ["log:read"]);
assert.equal((await w.handleWants(req("GET", null))).status, 401);
assert.equal((await w.handleWants(req("POST", reader.token, { title: "x" }))).status, 403);
assert.equal((await w.handleWants(req("POST", writer.token, { title: "" }))).status, 400);
const made = await w.handleWants(req("POST", writer.token, { title: "Watch", first: { price: 400, url: "https://example.com/w" } }));
assert.equal(made.status, 201);
const wid = ((await made.json()) as { id: number }).id;
const got = (await (await w.handleWants(req("GET", reader.token))).json()) as { wants: { id: number; options: { id: number; priceCents: number }[] }[] };
const watch = got.wants.find((x) => x.id === wid)!;
assert.equal(watch.options[0]!.priceCents, 40000);
const optId = watch.options[0]!.id;
assert.equal((await w.handleAddOption(req("POST", writer.token, { title: "Watch 2" }), String(wid))).status, 201);
assert.equal((await w.handleAddOption(req("POST", writer.token, { title: "Watch 2" }), "999999")).status, 404);
assert.equal((await w.handleAddOption(req("POST", reader.token, { title: "Watch 3" }), String(wid))).status, 403);
assert.equal((await w.handleOption(req("PATCH", writer.token, { price: 350 }), String(optId))).status, 200);
assert.equal((await w.handleOption(req("PATCH", reader.token, { price: 1 }), String(optId))).status, 403);
assert.equal((await w.handleOption(req("PATCH", writer.token, { price: -5 }), String(optId))).status, 400);
assert.equal((await w.handleOption(req("PATCH", writer.token, { price: 1 }), "999999")).status, 404);
assert.equal((await w.handleOption(req("PATCH", writer.token, { price: 1 }), "abc")).status, 404);
assert.equal((await w.handleWant(req("PATCH", writer.token, { status: "dropped" }), String(wid))).status, 200);
assert.equal((await w.handleOption(req("DELETE", writer.token), String(optId))).status, 200);
assert.equal((await w.handleOption(req("DELETE", writer.token), String(optId))).status, 404);
assert.equal((await w.handleWant(req("DELETE", writer.token), String(wid))).status, 200);
assert.equal((await w.handleWant(req("DELETE", writer.token), String(wid))).status, 404);

await db().delete(wants);
await db().delete(apiTokens);
console.log("wants: ok");
process.exit(0);
