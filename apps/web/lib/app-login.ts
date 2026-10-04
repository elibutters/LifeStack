import "server-only";
import { z } from "zod";
import { checkPassword, clientIp } from "./login-guard";
import { describeError } from "./errors";
import { createAppToken } from "./tokens";

// POST /api/v1/auth/login: the iPhone app trades the owner password for its own revocable key, once.
// The password is never stored on the device; only the key is, in the Keychain. The attempt limit is
// the same as the web form's. /api/v1/ skips the session gate, so this authenticates itself.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const Body = z.object({ password: z.string().min(1).max(200), device: z.string().trim().max(60).optional() });
const STATUS = { not_configured: 503, unavailable: 503, throttled: 429, wrong: 401 } as const;

export async function handleLogin(req: Request): Promise<Response> {
  // A native app sends no Origin header; a browser page on another site does, so refuse it.
  if (req.headers.get("origin")) return json({ error: "forbidden" }, 403);
  const text = await req.text();
  if (text.length > 1024) return json({ error: "too_large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return json({ error: "invalid" }, 400);

  const result = await checkPassword(clientIp(req.headers), parsed.data.password);
  if (!result.ok) return json({ error: result.reason }, STATUS[result.reason]);
  try {
    const { token } = await createAppToken(parsed.data.device || "iPhone");
    return json({ token });
  } catch (e) {
    console.error("login: could not issue a key", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}
