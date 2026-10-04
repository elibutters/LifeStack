// Maps a laptop worker's Amazon snapshot onto `events` rows. Pure so it can be tested alone.
import { z } from "zod";

export const AMAZON = "amazon";
export const ORDER_KEY = "commerce.order_item";
export const CART_KEY = "commerce.cart_item";
export const LOGIN_REQUIRED = "Amazon sign-in expired. Open Chrome on the worker laptop and sign in again.";

const Asin = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]{10}$/i)
  .transform((s) => s.toUpperCase())
  .optional();
const Qty = z.number().int().min(1).max(99);
const Money = z.number().min(0).max(100_000).nullable().optional();
const Title = z.string().trim().min(1).max(300);
const When = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);

export const CartItem = z.object({
  asin: Asin,
  title: Title,
  quantity: Qty.default(1),
  amount: Money,
  addedAt: When.optional(),
});

export const OrderItem = z.object({
  orderId: z.string().trim().regex(/^\d{3}-\d{7}-\d{7}$/),
  orderDate: When,
  asin: Asin,
  title: Title,
  quantity: Qty.default(1),
  amount: Money,
  status: z.string().trim().max(40).optional(),
  line: z.number().int().min(0).max(99).optional(),
});

export const Snapshot = z
  .object({
    status: z.enum(["ok", "login_required"]),
    cart: z.array(CartItem).max(100).optional(),
    orders: z.array(OrderItem).max(500).optional(),
  })
  .strict();

export type SnapshotT = z.infer<typeof Snapshot>;
export type CartItemT = z.infer<typeof CartItem>;
export type OrderItemT = z.infer<typeof OrderItem>;

export type AmazonRow = {
  ts: Date;
  domain: "commerce";
  key: typeof ORDER_KEY | typeof CART_KEY;
  valueNum: number | null;
  valueText: string;
  payload: Record<string, unknown>;
  source: typeof AMAZON;
  sourceId: string;
};

const at = (s: string) => {
  const d = s.length === 10 ? new Date(`${s}T12:00:00Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function orderSourceId(item: OrderItemT, index: number): string {
  const line = item.line ?? index;
  return item.asin ? `ord:${item.orderId}:${item.asin}:${line}` : `ord:${item.orderId}:line:${line}`;
}

export function cartSourceId(item: CartItemT, index: number): string {
  return item.asin ? `cart:${item.asin}` : `cart:line:${index}`;
}

export function rowsFromSnapshot(data: SnapshotT, now = new Date()): { orders: AmazonRow[]; cart: AmazonRow[] } {
  if (data.status !== "ok") return { orders: [], cart: [] };
  const orders: AmazonRow[] = [];
  for (const [i, item] of (data.orders ?? []).entries()) {
    const ts = at(item.orderDate);
    if (!ts) continue;
    orders.push({
      ts,
      domain: "commerce",
      key: ORDER_KEY,
      valueNum: item.amount ?? null,
      valueText: item.title,
      payload: {
        orderId: item.orderId,
        quantity: item.quantity,
        ...(item.asin ? { asin: item.asin } : {}),
        ...(item.status ? { status: item.status } : {}),
      },
      source: AMAZON,
      sourceId: orderSourceId(item, i),
    });
  }
  const cart: AmazonRow[] = [];
  for (const [i, item] of (data.cart ?? []).entries()) {
    const ts = item.addedAt ? at(item.addedAt) : now;
    if (!ts) continue;
    cart.push({
      ts,
      domain: "commerce",
      key: CART_KEY,
      valueNum: item.amount ?? null,
      valueText: item.title,
      payload: {
        quantity: item.quantity,
        ...(item.asin ? { asin: item.asin } : {}),
      },
      source: AMAZON,
      sourceId: cartSourceId(item, i),
    });
  }
  return { orders, cart };
}
