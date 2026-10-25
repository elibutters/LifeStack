import { z } from "zod";

// Pure registry of the preferences that can be changed without a deploy. Anything not listed here cannot be set, and every value
// is validated against its schema, so a bad value from an agent or a typo cannot reach the code that uses it.
const Phrase = z.string().trim().min(2).max(60);
const Phrases = z.array(Phrase).max(50);

export const EmailRules = z
  .object({ receipt: Phrases, shipping: Phrases, bill: Phrases, appointment: Phrases, deal: Phrases, other: Phrases })
  .partial()
  .strict();
export type EmailRulesT = z.infer<typeof EmailRules>;

export const SETTINGS = {
  "email.rules": {
    description:
      'Extra mail sorting rules: for each category (receipt, shipping, bill, appointment, deal, other) a list of phrases. A message whose subject, sender name or sender address contains a phrase goes in that category, ahead of the built-in rules. "other" forces a message out of every category. Example: {"bill":["con edison"],"other":["newsletter"]}. Existing mail is re-sorted when this changes.',
    schema: EmailRules,
    default: {} as EmailRulesT,
  },
  "map.style": { description: "Default map background on the web Map page: dark, light, streets, satellite or none (points only).", schema: z.enum(["dark", "light", "streets", "satellite", "none"]), default: "dark" as const },
  "map.lines": { description: "Whether the web Map page draws a line joining the points by default.", schema: z.boolean(), default: true },
  "map.range": { description: "Default time range on the web Map page: 7 (days), 30 (days) or all.", schema: z.enum(["7", "30", "all"]), default: "all" as const },
  "location.tripDistanceM": { description: "Trip mode in the iPhone app: metres between recorded points while moving (10 to 200). Smaller is more detailed and uses more battery and storage.", schema: z.number().int().min(10).max(200), default: 30 },
  "location.tripStillMinutes": { description: "Trip mode in the iPhone app: minutes standing still before detailed tracking switches off (1 to 30).", schema: z.number().int().min(1).max(30), default: 4 },
  "location.tripExitRadiusM": { description: "Trip mode in the iPhone app: how far in metres you must move from where you stopped before detailed tracking starts (100 to 500).", schema: z.number().int().min(100).max(500), default: 120 },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const isSettingKey = (k: string): k is SettingKey => Object.prototype.hasOwnProperty.call(SETTINGS, k);

export function parseSetting(key: string, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!isSettingKey(key)) return { ok: false, error: `Unknown setting. Known settings: ${SETTING_KEYS.join(", ")}.` };
  const p = SETTINGS[key].schema.safeParse(value);
  if (p.success) return { ok: true, value: p.data };
  return { ok: false, error: p.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
}

export type SettingView = { key: SettingKey; description: string; value: unknown; default: unknown; custom: boolean; updatedAt: string | null };

// Every setting with its current value: the stored one if it is valid, otherwise the default (a damaged row is ignored).
export function resolveAll(overrides: Record<string, { value: unknown; updatedAt: Date }>): SettingView[] {
  return SETTING_KEYS.map((key) => {
    const o = overrides[key];
    const parsed = o ? parseSetting(key, o.value) : null;
    const custom = !!parsed?.ok;
    return { key, description: SETTINGS[key].description, value: custom ? parsed.value : SETTINGS[key].default, default: SETTINGS[key].default, custom, updatedAt: custom ? o!.updatedAt.toISOString() : null };
  });
}

export const valueOf = <K extends SettingKey>(views: SettingView[], key: K): z.infer<(typeof SETTINGS)[K]["schema"]> => views.find((v) => v.key === key)!.value as z.infer<(typeof SETTINGS)[K]["schema"]>;
