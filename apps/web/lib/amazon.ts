import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { events, syncState } from "@lifestack/db";
import { db } from "./db";
import { describeError } from "./errors";
import {
  AMAZON,
  CART_KEY,
  LOGIN_REQUIRED,
  ORDER_KEY,
  rowsFromSnapshot,
  Snapshot,
  type SnapshotT,
} from "./amazon-map";

export { AMAZON, CART_KEY, LOGIN_REQUIRED, ORDER_KEY };

async function recordState(set: { lastOkAt?: Date; lastError?: string | null }) {
  await db()
    .insert(syncState)
    .values({ source: AMAZON, ...set })
    .onConflictDoUpdate({ target: syncState.source, set });
}

export async function getAmazonSyncState() {
  const [row] = await db().select().from(syncState).where(eq(syncState.source, AMAZON));
  return row ?? null;
}

export async function disconnectAmazon() {
  await db().delete(syncState).where(eq(syncState.source, AMAZON));
  await db().delete(events).where(eq(events.source, AMAZON));
}

const chunk = <T>(list: T[], n = 500) => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

export async function ingestSnapshot(raw: SnapshotT): Promise<{ orders: number; cart: number } | { loginRequired: true }> {
  if (raw.status === "login_required") {
    await recordState({ lastError: LOGIN_REQUIRED });
    return { loginRequired: true };
  }
  const { orders, cart } = rowsFromSnapshot(raw);
  const orderIds = [...new Map(orders.map((r) => [r.sourceId, r])).values()];
  const cartIds = [...new Map(cart.map((r) => [r.sourceId, r])).values()];
  try {
    await db().transaction(async (tx) => {
      for (const part of chunk(orderIds)) {
        if (!part.length) continue;
        await tx
          .insert(events)
          .values(part)
          .onConflictDoUpdate({
            target: [events.source, events.sourceId],
            set: {
              ts: sql`excluded.ts`,
              valueNum: sql`excluded.value_num`,
              valueText: sql`excluded.value_text`,
              payload: sql`excluded.payload`,
            },
          });
      }
      await tx.delete(events).where(and(eq(events.source, AMAZON), eq(events.key, CART_KEY)));
      for (const part of chunk(cartIds)) {
        if (!part.length) continue;
        await tx.insert(events).values(part);
      }
    });
    await recordState({ lastOkAt: new Date(), lastError: null });
    return { orders: orderIds.length, cart: cartIds.length };
  } catch (e) {
    console.error("amazon: ingest failed", describeError(e));
    await recordState({ lastError: "Snapshot could not be saved. The worker will retry." }).catch(() => {});
    throw e;
  }
}

export function parseSnapshot(body: unknown) {
  return Snapshot.safeParse(body);
}

export type AmazonItem = {
  sourceId: string;
  ts: Date;
  title: string;
  amount: number | null;
  quantity: number;
  asin: string | null;
  orderId: string | null;
  status: string | null;
};

const qty = (p: Record<string, unknown>) => (typeof p.quantity === "number" && p.quantity > 0 ? p.quantity : 1);
const text = (p: Record<string, unknown>, k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);

function toItem(row: { sourceId: string; ts: Date; valueNum: number | null; valueText: string | null; payload: unknown }): AmazonItem {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  return {
    sourceId: row.sourceId,
    ts: row.ts,
    title: row.valueText ?? "Item",
    amount: row.valueNum,
    quantity: qty(p),
    asin: text(p, "asin"),
    orderId: text(p, "orderId"),
    status: text(p, "status"),
  };
}

export async function loadAmazon() {
  const [state, orderRows, cartRows] = await Promise.all([
    getAmazonSyncState(),
    db()
      .select({
        sourceId: events.sourceId,
        ts: events.ts,
        valueNum: events.valueNum,
        valueText: events.valueText,
        payload: events.payload,
      })
      .from(events)
      .where(and(eq(events.source, AMAZON), eq(events.key, ORDER_KEY)))
      .orderBy(desc(events.ts))
      .limit(400),
    db()
      .select({
        sourceId: events.sourceId,
        ts: events.ts,
        valueNum: events.valueNum,
        valueText: events.valueText,
        payload: events.payload,
      })
      .from(events)
      .where(and(eq(events.source, AMAZON), eq(events.key, CART_KEY)))
      .orderBy(desc(events.ts))
      .limit(100),
  ]);
  return {
    state,
    orders: orderRows.filter((r) => r.sourceId).map((r) => toItem({ ...r, sourceId: r.sourceId! })),
    cart: cartRows.filter((r) => r.sourceId).map((r) => toItem({ ...r, sourceId: r.sourceId! })),
  };
}
