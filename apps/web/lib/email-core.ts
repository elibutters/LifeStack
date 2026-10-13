// Pure rules for turning a message into a category and a few structured facts. No network, no database.
export const CATEGORIES = ["receipt", "shipping", "bill", "appointment", "deal", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export type MailInput = { fromName?: string | null; fromAddress?: string | null; subject: string; body: string; receivedAt: Date };
export type Extracted = {
  merchant?: string;
  amountCents?: number;
  tracking?: { carrier: string; number: string };
  dueDate?: string; // YYYY-MM-DD
  eventDate?: string; // YYYY-MM-DD
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NAMED = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
const NUMERIC = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g;

const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};

// Dates mentioned in text, in order. A date with no year is the next one on or after about a month before the message arrived.
export function findDates(text: string, received: Date): string[] {
  const out: { at: number; day: string }[] = [];
  const floor = received.getTime() - 30 * 86_400_000;
  const y0 = received.getUTCFullYear();
  for (const m of text.matchAll(NAMED)) {
    const mon = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1;
    const d = Number(m[2]);
    let day = m[3] ? iso(Number(m[3]), mon, d) : iso(y0, mon, d);
    if (day && !m[3] && Date.parse(day) < floor) day = iso(y0 + 1, mon, d);
    if (day) out.push({ at: m.index!, day });
  }
  for (const m of text.matchAll(NUMERIC)) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const day = iso(y, Number(m[1]), Number(m[2]));
    if (day) out.push({ at: m.index!, day });
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.day);
}

const dollars = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);

export function findAmountCents(subject: string, body: string): number | undefined {
  const labelled = body.match(/(?:order total|grand total|total|amount due|balance due|amount charged|you paid|payment of|charged)\b[^\d$\n]{0,30}\$\s?(\d[\d,]*(?:\.\d{2})?)/i);
  if (labelled) return dollars(labelled[1]!);
  const any = (subject + "\n" + body).match(/\$\s?(\d[\d,]*\.\d{2})/);
  return any ? dollars(any[1]!) : undefined;
}

export function findTracking(text: string): { carrier: string; number: string } | undefined {
  const ups = text.match(/\b1Z[0-9A-Z]{16}\b/);
  if (ups) return { carrier: "UPS", number: ups[0] };
  const usps = text.match(/\b9[2-5]\d{18,20}\b/);
  if (usps) return { carrier: "USPS", number: usps[0] };
  if (/fedex/i.test(text)) {
    const fx = text.match(/\b(\d{15}|\d{12})\b/);
    if (fx) return { carrier: "FedEx", number: fx[1]! };
  }
  return undefined;
}

const RULES: { category: Category; subject: RegExp }[] = [
  { category: "shipping", subject: /\b(shipped|has shipped|out for delivery|delivered|tracking|arriving|on its way|delivery update)\b/i },
  { category: "appointment", subject: /\b(appointment|reservation|booking|itinerary|check-?in|your (?:visit|flight|stay|table)|reminder:|confirmed for|scheduled for)\b/i },
  { category: "bill", subject: /\b(statement|amount due|payment due|bill is ready|your bill|autopay|invoice|past due|due (?:soon|on|date))\b/i },
  { category: "receipt", subject: /\b(receipt|order confirmation|your order|order #|order number|payment received|thanks for your (?:order|purchase)|purchase)\b/i },
  { category: "deal", subject: /(\d+% off|\bsale\b|\bdeals?\b|coupon|promo|save \$|price drop|limited time|free shipping|clearance)/i },
];

export function categorize(m: Pick<MailInput, "subject" | "body">): Category {
  for (const r of RULES) if (r.subject.test(m.subject)) return r.category;
  if (findTracking(m.body.slice(0, 3000)) && /\b(shipped|tracking|delivery)\b/i.test(m.body.slice(0, 1500))) return "shipping";
  return "other";
}

export function extract(m: MailInput, category: Category): Extracted {
  const out: Extracted = {};
  const merchant = (m.fromName ?? "").trim();
  if (merchant && category !== "other") out.merchant = merchant.slice(0, 80);
  const text = m.body.slice(0, 6000);
  if (category === "receipt" || category === "bill") {
    const cents = findAmountCents(m.subject, text);
    if (cents != null && cents < 100_000_000) out.amountCents = cents;
  }
  if (category === "shipping") {
    const t = findTracking(text);
    if (t) out.tracking = t;
    const d = findDates(m.subject + "\n" + text.slice(0, 1500), m.receivedAt)[0];
    if (d) out.eventDate = d; // expected delivery
  }
  if (category === "bill") {
    const due = text.match(/due[^\n]{0,40}/i);
    const d = findDates(due?.[0] ?? "", m.receivedAt)[0] ?? findDates(m.subject, m.receivedAt)[0];
    if (d) out.dueDate = d;
  }
  if (category === "appointment") {
    const d = findDates(m.subject + "\n" + text.slice(0, 2000), m.receivedAt)[0];
    if (d) out.eventDate = d;
  }
  return out;
}

export const classify = (m: MailInput) => {
  const category = categorize(m);
  return { category, extracted: extract(m, category) };
};

const BODY_CAP = 6000;
const DEAL_CAP = 1200;

// Keeps what is worth reading later: collapses whitespace runs and caps length (marketing mail is capped harder).
export function tidyBody(text: string, category: Category): string {
  const t = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return t.slice(0, category === "deal" ? DEAL_CAP : BODY_CAP);
}

export const snippet = (text: string, n = 300) => text.replace(/\s+/g, " ").trim().slice(0, n);

export type AgendaItem = { id: number; kind: "bill" | "appointment" | "delivery"; date: string; title: string; amountCents?: number; from?: string };

// What is coming up, from the facts pulled out of recent mail. Items before `today` are left out.
export function agendaOf(
  rows: { id: number; category: string; subject: string; fromName: string | null; extracted: Extracted }[],
  today: string,
): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const r of rows) {
    const date = r.category === "bill" ? r.extracted.dueDate : r.extracted.eventDate;
    if (!date || date < today) continue;
    const kind = r.category === "bill" ? "bill" : r.category === "appointment" ? "appointment" : r.category === "shipping" ? "delivery" : null;
    if (!kind) continue;
    items.push({ id: r.id, kind, date, title: r.subject, ...(r.extracted.amountCents != null ? { amountCents: r.extracted.amountCents } : {}), ...(r.fromName ? { from: r.fromName } : {}) });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}
