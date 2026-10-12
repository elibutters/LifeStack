import { z } from "zod";

// Pure rules for the Wants list. A want is the need ("a jacket"); options are the candidates.
// Only one option is ever bought, and a want may have just one option.
export const WANT_STATUSES = ["want", "bought", "dropped"] as const;
export const OPTION_STATUSES = ["considering", "chosen", "rejected"] as const;
export type WantStatus = (typeof WANT_STATUSES)[number];
export type OptionStatus = (typeof OPTION_STATUSES)[number];

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s));

const Url = z
  .string()
  .trim()
  .max(500)
  .refine((s) => s === "" || /^https?:\/\/\S+$/i.test(s), "must be an http(s) link")
  .transform((s) => (s === "" ? null : s));

// Dollars in, whole cents out. Empty means none.
const Money = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? (v.trim() === "" ? null : Number(v.replace(/[$,\s]/g, ""))) : v))
  .refine((n) => n === null || (Number.isFinite(n) && n >= 0 && n <= 10_000_000), "must be 0 to 10000000")
  .transform((n) => (n === null ? null : Math.round(n * 100)));

const Title = z.string().trim().min(1).max(120);
const nonEmpty = (o: object) => Object.keys(o).length > 0;

export const WantInput = z.object({ title: Title, note: text(500).nullish(), budget: Money.nullish() });
export const WantPatch = z.object({ title: Title, note: text(500), budget: Money, status: z.enum(WANT_STATUSES) }).partial().refine(nonEmpty, "nothing to change");

export const OptionInput = z.object({ title: Title, url: Url.nullish(), price: Money.nullish(), target: Money.nullish(), note: text(500).nullish() });
export const OptionPatch = z
  .object({ title: Title, url: Url, price: Money, target: Money, note: text(500), status: z.enum(OPTION_STATUSES) })
  .partial()
  .refine(nonEmpty, "nothing to change");

export type WantOption = {
  id: number;
  wantId: number;
  title: string;
  url: string | null;
  priceCents: number | null;
  priceCheckedAt: string | null;
  targetCents: number | null;
  note: string | null;
  status: OptionStatus;
  atTarget: boolean; // the latest price is at or under the target
};
export type Want = {
  id: number;
  title: string;
  note: string | null;
  budgetCents: number | null;
  status: WantStatus;
  createdAt: string;
  bestPriceCents: number | null; // lowest latest price among options still in the running
  options: WantOption[];
};

export const atTarget = (price: number | null, target: number | null) => price != null && target != null && price <= target;

// Lowest price among options still in the running (the chosen one once bought).
export function bestPrice(options: Pick<WantOption, "status" | "priceCents">[]): number | null {
  const live = options.filter((o) => o.status !== "rejected" && o.priceCents != null).map((o) => o.priceCents!);
  return live.length ? Math.min(...live) : null;
}

export function summarize(items: Pick<Want, "status" | "options">[]) {
  const open = items.filter((w) => w.status === "want");
  return {
    open: open.length,
    bought: items.filter((w) => w.status === "bought").length,
    deals: open.flatMap((w) => w.options).filter((o) => o.status === "considering" && o.atTarget).length,
  };
}

export const fmtCents = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
