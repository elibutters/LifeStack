// Amazon snapshot mapping and ingest. Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) {
  console.error("refusing to run: not the test database");
  process.exit(2);
}

const map = await import("../lib/amazon-map.ts");
const amazon = await import("../lib/amazon.ts");
const api = await import("../lib/amazon-api.ts");
const tok = await import("../lib/tokens.ts");
const { db } = await import("../lib/db.ts");
const { events, apiTokens, syncState } = await import("@lifestack/db");
const { eq } = await import("drizzle-orm");

const ok = (v: unknown) => map.Snapshot.safeParse(v).success;
assert.ok(ok({ status: "login_required" }));
assert.ok(ok({ status: "ok", cart: [], orders: [] }));
assert.ok(
  ok({
    status: "ok",
    orders: [{ orderId: "111-1234567-1234567", orderDate: "2026-09-01T12:00:00Z", title: "USB cable", quantity: 2, amount: 12.5, asin: "B00TEST001" }],
    cart: [{ title: "Notebook", quantity: 1, asin: "B00CART001", addedAt: "2026-10-01T15:00:00Z" }],
  }),
);
assert.ok(!ok({ status: "ok", extra: true }));
assert.ok(!ok({ status: "ok", orders: [{ orderId: "not-an-id", orderDate: "2026-09-01T12:00:00Z", title: "x" }] }));
assert.ok(!ok({ status: "ok", cart: [{ title: "" }] }));

const rows = map.rowsFromSnapshot({
  status: "ok",
  orders: [
    { orderId: "111-1234567-1234567", orderDate: "2026-09-01T12:00:00Z", title: "USB cable", quantity: 2, amount: 12.5, asin: "B00TEST001", line: 0, status: "Delivered" },
  ],
  cart: [{ title: "Notebook", quantity: 1, asin: "B00CART001", addedAt: "2026-10-01T15:00:00Z", amount: 8 }],
});
assert.equal(rows.orders[0]!.sourceId, "ord:111-1234567-1234567:B00TEST001:0");
assert.equal(rows.orders[0]!.domain, "commerce");
assert.equal(rows.orders[0]!.key, map.ORDER_KEY);
assert.equal(rows.cart[0]!.sourceId, "cart:B00CART001");
assert.deepEqual(map.rowsFromSnapshot({ status: "login_required" }), { orders: [], cart: [] });

await db().delete(events).where(eq(events.source, map.AMAZON));
await db().delete(syncState).where(eq(syncState.source, map.AMAZON));
await db().delete(apiTokens);

const writer = await tok.createToken("Amazon box", "widget", ["amazon:write"]);
const logger = await tok.createToken("Logs only", "shortcut", ["log:write"]);
const call = (token: string | null, body: unknown, raw?: string) =>
  new Request("http://localhost/api/v1/amazon/snapshot", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: raw ?? JSON.stringify(body),
  });
const post = async (token: string | null, body: unknown, raw?: string) => {
  const res = await api.handleAmazonSnapshot(call(token, body, raw));
  return { status: res.status, json: await res.json().catch(() => null) };
};

assert.equal((await post(null, { status: "ok" })).status, 401);
assert.equal((await post(logger.token, { status: "ok" })).status, 403);
assert.equal((await post(writer.token, null, "{nope")).json.error, "invalid_json");
const bad = await post(writer.token, { status: "ok", orders: [{ orderId: "nope", orderDate: "2026-09-01T12:00:00Z", title: "SECRET-ITEM" }] });
assert.equal(bad.status, 400);
assert.ok(!JSON.stringify(bad.json).includes("SECRET-ITEM"));

const first = await post(writer.token, {
  status: "ok",
  orders: [{ orderId: "111-1234567-1234567", orderDate: "2026-09-01T12:00:00Z", title: "USB cable", quantity: 1, amount: 10, asin: "B00TEST001", line: 0 }],
  cart: [{ title: "Notebook", quantity: 1, asin: "B00CART001" }],
});
assert.equal(first.status, 200);
assert.deepEqual([first.json.orders, first.json.cart], [1, 1]);
let stored = await db().select().from(events).where(eq(events.source, map.AMAZON));
assert.equal(stored.length, 2);

const again = await post(writer.token, {
  status: "ok",
  orders: [
    { orderId: "111-1234567-1234567", orderDate: "2026-09-01T12:00:00Z", title: "USB cable", quantity: 1, amount: 9.5, asin: "B00TEST001", line: 0 },
    { orderId: "111-1234567-7654321", orderDate: "2026-09-15", title: "Tape", quantity: 1, amount: 4, line: 0 },
  ],
  cart: [{ title: "Pens", quantity: 3, asin: "B00PENS001" }],
});
assert.equal(again.status, 200);
stored = await db().select().from(events).where(eq(events.source, map.AMAZON));
assert.equal(stored.filter((r) => r.key === map.CART_KEY).length, 1);
assert.equal(stored.filter((r) => r.key === map.CART_KEY)[0]!.valueText, "Pens");
assert.equal(stored.filter((r) => r.key === map.ORDER_KEY).length, 2);
assert.equal(stored.find((r) => r.valueText === "USB cable")!.valueNum, 9.5);

const login = await post(writer.token, { status: "login_required" });
assert.equal(login.json.loginRequired, true);
const afterLogin = await amazon.loadAmazon();
assert.equal(afterLogin.orders.length, 2, "login_required must not wipe orders");
assert.equal(afterLogin.state?.lastError, map.LOGIN_REQUIRED);

await amazon.disconnectAmazon();
stored = await db().select().from(events).where(eq(events.source, map.AMAZON));
assert.equal(stored.length, 0);
console.log("amazon tests ok");
