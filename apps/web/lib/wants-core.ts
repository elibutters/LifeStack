import { z } from "zod";

// Pure rules for the Wants list: what a want looks like and how a list is summarised.
export const WANT_STATUSES = ["want", "bought", "dropped"] as const;
export type WantStatus = (typeof WANT_STATUSES)[number];

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

// Dollars in, whole cents out. Empty means no price.
const Price = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? (v.trim() === "" ? null : Number(v.replace(/[$,\s]/g, ""))) : v))
  .refine((n) => n === null || (Number.isFinite(n) && n >= 0 && n <= 10_000_000), "must be 0 to 10000000")
  .transform((n) => (n === null ? null : Math.round(n * 100)));

export const WantInput = z.object({
  title: z.string().trim().min(1).max(120),
  note: text(500).nullish(),
  url: Url.nullish(),
  price: Price.nullish(),
});
export type WantInputT = z.infer<typeof WantInput>;

export const WantPatch = z
  .object({
    title: z.string().trim().min(1).max(120),
    note: text(500),
    url: Url,
    price: Price,
    status: z.enum(WANT_STATUSES),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "nothing to change");

export type Want = { id: number; title: string; note: string | null; url: string | null; priceCents: number | null; status: WantStatus; createdAt: string };

export function summarize(items: Pick<Want, "status" | "priceCents">[]) {
  const open = items.filter((w) => w.status === "want");
  return {
    open: open.length,
    bought: items.filter((w) => w.status === "bought").length,
    openTotalCents: open.reduce((s, w) => s + (w.priceCents ?? 0), 0),
    unpriced: open.filter((w) => w.priceCents == null).length,
  };
}

export const fmtCents = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
