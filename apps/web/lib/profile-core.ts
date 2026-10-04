// Owner profile: fields, validation, and the compact object agents receive.
// Pure (no database) so it can be tested on its own. Empty values are omitted.
import { z } from "zod";

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const HANDS = ["left", "right", "ambidextrous"] as const;

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

const optionalNum = (min: number, max: number) =>
  z.preprocess((v) => {
    const b = blank(v);
    if (b === undefined) return undefined;
    if (typeof b === "number") return b;
    if (typeof b === "string") return Number(b);
    return b;
  }, z.number().min(min).max(max).optional());

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
  preferredName: text(80),
  legalName: text(120),
  pronunciation: text(120),
  pronouns: text(40),
  dateOfBirth: optionalDay,
  sex: text(40),
  gender: text(80),
  heightCm: optionalNum(50, 250),
  weightKg: optionalNum(20, 400),
  bloodType: optionalEnum(BLOOD_TYPES),
  dominantHand: optionalEnum(HANDS),
  allergies: text(2000),
  medications: text(2000),
  conditions: text(2000),
  injuries: text(2000),
  diet: text(1000),
  fitnessNotes: text(2000),
  occupation: text(200),
  household: text(1000),
  relationship: text(120),
  city: text(120),
  languages: text(200),
  pets: text(500),
  howToAddress: text(120),
  communicationStyle: text(2000),
  goals: text(4000),
  values: text(4000),
  context: text(8000),
  avoid: text(4000),
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
    blurb: "Who you are. Agents should use the preferred name unless you say otherwise.",
    fields: [
      { key: "preferredName", label: "Preferred name", kind: "text", max: 80 },
      { key: "legalName", label: "Legal name", kind: "text", max: 120 },
      { key: "pronunciation", label: "Pronunciation", kind: "text", max: 120 },
      { key: "pronouns", label: "Pronouns", kind: "text", max: 40 },
      { key: "dateOfBirth", label: "Date of birth", kind: "date" },
      { key: "sex", label: "Sex", hint: "As used medically, if you want that recorded.", kind: "text", max: 40 },
      { key: "gender", label: "Gender", kind: "text", max: 80 },
    ],
  },
  {
    title: "Physical",
    blurb: "Body, health and training notes. Leave a field blank if an agent does not need it.",
    fields: [
      { key: "heightCm", label: "Height (cm)", kind: "number", step: "0.1" },
      { key: "weightKg", label: "Weight (kg)", kind: "number", step: "0.1" },
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
      { key: "diet", label: "Diet", kind: "textarea", max: 1000 },
      { key: "fitnessNotes", label: "Fitness notes", kind: "textarea", max: 2000 },
    ],
  },
  {
    title: "Life",
    blurb: "Context around work and home. Do not put workplace systems or firm data here.",
    fields: [
      { key: "occupation", label: "Occupation", kind: "text", max: 200 },
      { key: "household", label: "Household", kind: "textarea", max: 1000 },
      { key: "relationship", label: "Relationship", kind: "text", max: 120 },
      { key: "city", label: "City or region", kind: "text", max: 120 },
      { key: "languages", label: "Languages", kind: "text", max: 200 },
      { key: "pets", label: "Pets", kind: "textarea", max: 500 },
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

export function parseProfile(raw: unknown): { ok: true; profile: Profile } | { ok: false; issues: { path: string; message: string }[] } {
  const parsed = ProfileInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: String(i.path.join(".")), message: i.message })) };
  }
  return { ok: true, profile: compactProfile(parsed.data) };
}

export function compactProfile(p: Profile): Profile {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === "") continue;
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
  return { ...compactProfile(profile), timezone: extras.timezone, ...(extras.ageYears != null ? { ageYears: extras.ageYears } : {}) };
}

export function fromForm(form: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const section of PROFILE_SECTIONS) {
    for (const f of section.fields) {
      const v = form.get(f.key);
      if (typeof v === "string") raw[f.key] = v;
    }
  }
  return raw;
}

export function fieldValue(profile: Profile, key: keyof Profile): string {
  const v = profile[key];
  return v == null ? "" : String(v);
}
