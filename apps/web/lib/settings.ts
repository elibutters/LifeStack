import "server-only";
import { z } from "zod";
import { reclassifyEmails } from "./email";
import { describeError } from "./errors";
import { deleteSetting, loadOverrides, putSetting } from "./settings-store";
import { isSettingKey, parseSetting, resolveAll, SETTING_KEYS, SETTINGS, type EmailRulesT, type SettingKey, type SettingView } from "./settings-core";
import { verifyBearer } from "./tokens";

export async function listSettings(): Promise<SettingView[]> {
  return resolveAll(await loadOverrides());
}

// Some settings change what is already stored: new mail rules re-sort the existing mail.
async function afterChange(key: SettingKey, value: unknown): Promise<Record<string, unknown>> {
  if (key === "email.rules") return { reclassified: await reclassifyEmails(value as EmailRulesT) };
  return {};
}

export async function changeSetting(key: string, value: unknown): Promise<{ ok: true; view: SettingView; effects: Record<string, unknown> } | { ok: false; error: string }> {
  const parsed = parseSetting(key, value);
  if (!parsed.ok) return parsed;
  await putSetting(key, parsed.value);
  const effects = await afterChange(key as SettingKey, parsed.value);
  return { ok: true, view: (await listSettings()).find((v) => v.key === key)!, effects };
}

export async function resetSetting(key: string): Promise<{ ok: true; view: SettingView; effects: Record<string, unknown> } | { ok: false; error: string }> {
  if (!isSettingKey(key)) return { ok: false, error: `Unknown setting. Known settings: ${SETTING_KEYS.join(", ")}.` };
  await deleteSetting(key);
  const effects = await afterChange(key, SETTINGS[key].default);
  return { ok: true, view: (await listSettings()).find((v) => v.key === key)!, effects };
}

// ---- API (/api/v1/settings): read with settings:read, change with settings:write
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const Body = z.object({ key: z.string().max(60), value: z.unknown() });

async function guarded(req: Request, scope: "settings:read" | "settings:write", fn: () => Promise<Response>): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), scope);
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  try {
    return await fn();
  } catch (e) {
    console.error("settings: api failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

export const handleSettings = (req: Request) => {
  if (req.method === "GET") return guarded(req, "settings:read", async () => json({ settings: await listSettings() }));
  if (req.method === "DELETE")
    return guarded(req, "settings:write", async () => {
      const key = new URL(req.url).searchParams.get("key") ?? "";
      const r = await resetSetting(key);
      return r.ok ? json({ setting: r.view, effects: r.effects }) : json({ error: "invalid", message: r.error }, 400);
    });
  return guarded(req, "settings:write", async () => {
    const text = await req.text();
    if (text.length > 16 * 1024) return json({ error: "too_large" }, 413);
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return json({ error: "invalid_json" }, 400); }
    const b = Body.safeParse(raw);
    if (!b.success) return json({ error: "invalid" }, 400);
    const r = await changeSetting(b.data.key, b.data.value);
    return r.ok ? json({ setting: r.view, effects: r.effects }) : json({ error: "invalid", message: r.error }, 400);
  });
};
