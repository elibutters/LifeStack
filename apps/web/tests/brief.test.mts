// Daily briefs: validation, one row per day and kind, which one to show, and the bearer-protected API.
// Run with `pnpm test` (throwaway database only).
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL?.endsWith("/lifestack_test")) {
  console.error("refusing to run: not the test database");
  process.exit(2);
}
const core = await import("../lib/brief-core.ts");
const b = await import("../lib/brief.ts");
const tok = await import("../lib/tokens.ts");
const { db } = await import("../lib/db.ts");
const { events, apiTokens } = await import("@lifestack/db");
import { eq } from "drizzle-orm";

assert.equal(core.BriefInput.safeParse({ kind: "morning", headline: "Two things today" }).success, true);
assert.equal(core.BriefInput.safeParse({ kind: "noon", headline: "x" }).success, false);
assert.equal(core.BriefInput.safeParse({ kind: "morning", headline: "" }).success, false);
assert.equal(core.BriefInput.safeParse({ kind: "morning", headline: "x", sections: [{ title: "Behind", items: [] }] }).success, false, "a section needs an item");
assert.equal(core.BriefInput.safeParse({ kind: "morning", headline: "x", day: "tomorrow" }).success, false);
assert.equal(core.briefId("2026-11-15", "evening"), "2026-11-15:evening");

const mk = (day: string, kind: "morning" | "evening", createdAt: string) => ({ id: `${day}:${kind}`, kind, day, headline: "h", sections: [], question: null, createdAt, readAt: null });
const list = [mk("2026-11-14", "evening", "2026-11-14T23:30:00Z"), mk("2026-11-15", "morning", "2026-11-15T12:00:00Z"), mk("2026-11-13", "morning", "2026-11-13T12:00:00Z")];
assert.equal(core.currentBrief(list, "2026-11-15", "2026-11-14")?.id, "2026-11-15:morning", "today's wins");
assert.equal(core.currentBrief(list.slice(0, 1), "2026-11-15", "2026-11-14")?.id, "2026-11-14:evening", "last night's until the morning one exists");
assert.equal(core.currentBrief([list[2]!], "2026-11-15", "2026-11-14"), null, "older ones are not shown");
assert.equal(core.currentBrief([mk("2026-11-14", "morning", "2026-11-14T12:00:00Z")], "2026-11-15", "2026-11-14"), null, "yesterday's morning brief is stale");

await db().delete(events).where(eq(events.key, "brief.daily"));
const now = new Date("2026-11-15T13:00:00Z");
const first = await b.saveBrief({ kind: "morning", headline: "First", sections: [{ title: "Today", items: ["Run at 10"] }], question: "What first?" }, now) as any;
assert.equal(first.ok, true); assert.equal(first.day, "2026-11-15");
await b.saveBrief({ kind: "morning", headline: "Second" }, new Date(now.getTime() + 60_000));
const rows = await b.recentBriefs();
assert.equal(rows.length, 1, "the same day and kind is replaced, not added"); assert.equal(rows[0]!.headline, "Second");
await b.saveBrief({ kind: "evening", headline: "Night", day: "2026-11-15" }, new Date(now.getTime() + 3_600_000));
assert.equal((await b.recentBriefs()).length, 2);
assert.equal((await b.saveBrief({ kind: "morning", headline: "" }) as any).ok, false);
assert.equal((await b.latestBrief(new Date("2026-11-15T20:00:00Z")))?.headline, "Night");
assert.equal(await b.latestBrief(new Date("2026-11-20T20:00:00Z")), null, "five days on, nothing is current");

// ---- API
await db().delete(apiTokens);
const reader = await tok.createToken("phone", "app", ["brief:read"]);
const none = await tok.createToken("none", "agent", ["log:read"]);
const get = (token?: string) => b.handleBrief(new Request("http://x/api/v1/brief", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
assert.equal((await get()).status, 401);
assert.equal((await get(none.token)).status, 403);
const res = await get(reader.token);
assert.equal(res.status, 200);
const shown = (await res.json() as any).brief;
assert.equal(shown.readAt, null, "a new brief is unread");
const post = (body: unknown, token?: string) => b.handleBrief(new Request("http://x/api/v1/brief", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
assert.equal((await post({ id: shown.id })).status, 401);
assert.equal((await post({ id: "nonsense" }, reader.token)).status, 400);
const afterRead = await (await post({ id: shown.id }, reader.token)).json() as any;
assert.ok(afterRead.brief.readAt, "marked read");
const firstReadAt = afterRead.brief.readAt;
await new Promise((r) => setTimeout(r, 20));
assert.equal(((await (await post({ id: shown.id }, reader.token)).json()) as any).brief.readAt, firstReadAt, "reading again keeps the first time");
await b.saveBrief({ kind: "evening", headline: "Night, rewritten", day: shown.day }, new Date());
assert.equal((await b.latestBrief())?.readAt, null, "a re-run with new content is unread again");
console.log("brief tests passed");
process.exit(0);
