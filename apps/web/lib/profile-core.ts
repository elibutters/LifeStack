// Owner profile: fields, validation, and the compact object agents receive.
// Pure (no database) so it can be tested on its own. Empty values are omitted.
import { z } from "zod";

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const HANDS = ["left", "right", "ambidextrous"] as const;
export const CONTACT_KINDS = ["email", "phone", "username"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export type Contact = { kind: ContactKind; value: string; description?: string };

const blank = (v: unknown) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string" && v.trim() === "") return undefined;
  return v;
};

const text = (max: number) =>
  z.preprocess(
    blank,
    z
      .string()
      .trim()
      .max(max)
      .optional()
      .transform((s) => (s ? s : undefined)),
  );

const optionalEnum = <T extends string>(values: readonly T[]) =>
  z.preprocess(blank, z.enum(values as [T, ...T[]]).optional());

const optionalNum = (min: number, max: number, integer = false) =>
  z.preprocess((v) => {
    const b = blank(v);
    if (b === undefined) return undefined;
    if (typeof b === "number") return b;
    if (typeof b === "string") return Number(b);
    return b;
  }, (integer ? z.number().int() : z.number()).min(min).max(max).optional());

const optionalDay = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()).superRefine((d, ctx) => {
  if (!d) return;
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m! - 1 || dt.getUTCDate() !== day) {
    ctx.addIssue({ code: "custom", message: "date of birth must be a real day" });
    return;
  }
  if (y! < 1900) {
    ctx.addIssue({ code: "custom", message: "date of birth must be a real past day" });
    return;
  }
  const now = new Date();
  if (Date.UTC(y!, m! - 1, day) > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) {
    ctx.addIssue({ code: "custom", message: "date of birth must be a real past day" });
  }
});

export const ProfileInput = z.object({
  firstName: text(80),
  middleName: text(80),
  lastName: text(80),
  dateOfBirth: optionalDay,
  sex: text(40),
  heightFt: optionalNum(1, 8, true),
  heightIn: optionalNum(0, 11, true),
  weightLb: optionalNum(40, 900),
  bloodType: optionalEnum(BLOOD_TYPES),
  dominantHand: optionalEnum(HANDS),
  allergies: text(2000),
  medications: text(2000),
  conditions: text(2000),
  injuries: text(2000),
  occupation: text(200),
  household: text(1000),
  relationship: text(120),
  address1: text(120),
  address2: text(120),
  city: text(120),
  state: text(40),
  zip: text(10),
  contacts: z.preprocess((v) => {
    if (!Array.isArray(v)) return undefined;
    const rows = v.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const value = (item as { value?: unknown }).value;
      return typeof value === "string" && value.trim() !== "";
    });
    return rows.length ? rows : undefined;
  }, z.array(z.object({
    kind: z.enum(CONTACT_KINDS),
    value: z.string().trim().min(1).max(200),
    description: z.preprocess(
      blank,
      z
        .string()
        .trim()
        .max(120)
        .optional()
        .transform((s) => (s ? s : undefined)),
    ),
  }).transform(({ kind, value, description }) => (description ? { kind, value, description } : { kind, value }))).max(40).optional()),
  languages: text(200),
  howToAddress: text(120),
  communicationStyle: text(2000),
  goals: text(4000),
  values: text(4000),
  context: text(8000),
  avoid: text(4000),
})
  .superRefine((p, ctx) => {
    if (p.heightFt == null && p.heightIn == null) return;
    const total = (p.heightFt ?? 0) * 12 + (p.heightIn ?? 0);
    if (p.heightFt == null || total < 20 || total > 98) {
      ctx.addIssue({ code: "custom", path: ["heightFt"], message: "height must be between 1 ft 8 in and 8 ft 2 in" });
    }
  })
  .transform((p) => {
    const next = p.heightFt != null && p.heightIn == null ? { ...p, heightIn: 0 } : p;
    const joined = [next.firstName, next.middleName, next.lastName].filter(Boolean).join(" ");
    return { ...next, name: joined || undefined };
  });
export type Profile = Partial<z.output<typeof ProfileInput>>;

export type FieldKind = "text" | "textarea" | "date" | "number" | "select";
export type ProfileField = {
  key: keyof Profile;
  label: string;
  hint?: string;
  kind: FieldKind;
  max?: number;
  step?: string;
  options?: { value: string; label: string }[];
};
export type ProfileSection = { title: string; blurb: string; fields: ProfileField[] };

export const PROFILE_SECTIONS: ProfileSection[] = [
  {
    title: "Identity",
    blurb: "Who you are.",
    fields: [
      { key: "firstName", label: "First", kind: "text", max: 80 },
      { key: "middleName", label: "Middle", kind: "text", max: 80 },
      { key: "lastName", label: "Last", kind: "text", max: 80 },
      { key: "dateOfBirth", label: "Date of birth", kind: "date" },
      { key: "sex", label: "Sex", kind: "text", max: 40 },
    ],
  },
  {
    title: "Contact",
    blurb: "Each one is an email, phone number, or username, with a short description.",
    fields: [
      { key: "address1", label: "Address line 1", kind: "text", max: 120 },
      { key: "address2", label: "Address line 2", kind: "text", max: 120 },
      { key: "city", label: "City", kind: "text", max: 120 },
      { key: "state", label: "State", kind: "text", max: 40 },
      { key: "zip", label: "ZIP", kind: "text", max: 10 },
    ],
  },
  {
    title: "Physical",
    blurb: "Body and health. Leave a field blank if an agent does not need it.",
    fields: [
      { key: "heightFt", label: "Height (ft)", kind: "number", step: "1" },
      { key: "heightIn", label: "Height (in)", kind: "number", step: "1" },
      { key: "weightLb", label: "Weight (lb)", kind: "number", step: "0.1" },
      { key: "bloodType", label: "Blood type", kind: "select", options: BLOOD_TYPES.map((v) => ({ value: v, label: v })) },
      {
        key: "dominantHand",
        label: "Dominant hand",
        kind: "select",
        options: HANDS.map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })),
      },
      { key: "allergies", label: "Allergies", kind: "textarea", max: 2000 },
      { key: "medications", label: "Medications and supplements (standing)", kind: "textarea", max: 2000 },
      { key: "conditions", label: "Medical conditions", kind: "textarea", max: 2000 },
      { key: "injuries", label: "Injuries and limits", kind: "textarea", max: 2000 },
    ],
  },
  {
    title: "Life",
    blurb: "Context around work and home. Do not put workplace systems or firm data here.",
    fields: [
      { key: "occupation", label: "Occupation", kind: "text", max: 200 },
      { key: "household", label: "Household", kind: "textarea", max: 1000 },
      { key: "relationship", label: "Relationship", kind: "text", max: 120 },
      { key: "languages", label: "Languages", kind: "text", max: 200 },
    ],
  },
  {
    title: "For agents",
    blurb: "How a new agent should talk to you, what you are working toward, and what to avoid.",
    fields: [
      { key: "howToAddress", label: "How to address you", kind: "text", max: 120 },
      { key: "communicationStyle", label: "Communication style", kind: "textarea", max: 2000 },
      { key: "goals", label: "Goals", kind: "textarea", max: 4000 },
      { key: "values", label: "Values", kind: "textarea", max: 4000 },
      { key: "context", label: "Background", hint: "Anything a new agent should know on the first turn.", kind: "textarea", max: 8000 },
      { key: "avoid", label: "Do not", kind: "textarea", max: 4000 },
    ],
  },
];

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeIncoming(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  const filled = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : undefined);
  const hasPart = [o.firstName, o.middleName, o.lastName].some((v) => filled(v) !== undefined);
  if (!hasPart) {
    const carried = filled(o.preferredName) ?? filled(o.legalName) ?? filled(o.name);
    if (carried !== undefined) {
      const parts = carried.trim().split(/\s+/);
      o.firstName = parts[0];
      if (parts.length === 2) o.lastName = parts[1];
      else if (parts.length > 2) {
        o.middleName = parts.slice(1, -1).join(" ");
        o.lastName = parts.at(-1);
      }
    }
  }
  if (asNumber(o.heightFt) === undefined && asNumber(o.heightIn) === undefined) {
    const cm = asNumber(o.heightCm);
    if (cm !== undefined) {
      const total = Math.round(cm / 2.54);
      o.heightFt = Math.floor(total / 12);
      o.heightIn = total % 12;
    }
  }
  if (asNumber(o.weightLb) === undefined) {
    const kg = asNumber(o.weightKg);
    if (kg !== undefined) o.weightLb = Math.round(kg * 2.2046226218 * 10) / 10;
  }
  return o;
}

export function parseProfile(raw: unknown): { ok: true; profile: Profile } | { ok: false; issues: { path: string; message: string }[] } {
  const parsed = ProfileInput.safeParse(normalizeIncoming(raw));
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: String(i.path.join(".")), message: i.message })) };
  }
  return { ok: true, profile: compactProfile(parsed.data) };
}

export function compactProfile(p: Profile): Profile {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as Profile;
}

export function ageYears(dateOfBirth: string | undefined, todayYmd: string): number | null {
  if (!dateOfBirth) return null;
  const [ty, tm, td] = todayYmd.split("-").map(Number);
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  if (!ty || !tm || !td || !by || !bm || !bd) return null;
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export function publicProfile(profile: Profile, extras: { timezone: string; ageYears: number | null }) {
  const compact = compactProfile(profile);
  const name = [compact.firstName, compact.middleName, compact.lastName].filter(Boolean).join(" ");
  const { name: _stored, ...rest } = compact;
  return { ...rest, ...(name ? { name } : {}), timezone: extras.timezone, ...(extras.ageYears != null ? { ageYears: extras.ageYears } : {}) };
}

export function fromForm(form: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const section of PROFILE_SECTIONS) {
    for (const f of section.fields) {
      const v = form.get(f.key);
      if (typeof v === "string") raw[f.key] = v;
    }
  }
  const kinds = form.getAll("contactKind");
  const values = form.getAll("contactValue");
  const descriptions = form.getAll("contactDescription");
  raw.contacts = kinds.map((kind, i) => ({
    kind: typeof kind === "string" ? kind : "",
    value: typeof values[i] === "string" ? values[i] : "",
    description: typeof descriptions[i] === "string" ? descriptions[i] : "",
  }));
  return raw;
}

export function fieldValue(profile: Profile, key: keyof Profile): string {
  const v = profile[key];
  return v == null ? "" : String(v);
}
