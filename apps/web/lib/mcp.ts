import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EventInput, type Scope } from "./capture-core";
import { insertLog, loadToday } from "./capture";
import { loadOverview, loadWeekSummary } from "./overview";
import { calendarItems } from "./calendar";
import { addDays, isValidDay, startOfDay, ymd } from "./dates";
import { describeError } from "./errors";
import { classify, fmtMoney, insights, merchantName, monthOf, netWorth, shiftMonthKey, summarizeMonth, accountLabel } from "./finance-calc";
import { loadFinance, loadHoldings } from "./finance-data";
import { loadProfile, profileForAgents } from "./profile";
import { loadNights } from "./sleep";
import type { VerifiedToken } from "./tokens";

// MCP tools for agents. A tool is only offered to a key that carries its scope, so a key made for
// one area cannot reach another. Everything returned is read from the database; account numbers and
// credentials are never stored, so they cannot be returned.
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
const guard = (fn: () => Promise<ReturnType<typeof ok>>) => async () => {
  try {
    return await fn();
  } catch (e) {
    console.error("mcp: tool failed", describeError(e));
    return fail("The tool could not read the data.");
  }
};

const Day = z.string().refine(isValidDay, "use YYYY-MM-DD");
const MAX_RANGE_DAYS = 90;

export function buildServer(token: VerifiedToken): McpServer {
  const server = new McpServer({ name: "life-stack", version: "1.0.0" });
  const has = (s: Scope) => token.scopes.includes(s);

  if (has("log:read") || has("calendar:read") || has("sleep:read") || has("finance:read")) {
    server.registerTool(
      "get_overview",
      { description: "A compact digest of today: log, calendar, last night's sleep and a finance snapshot, including only the areas this key can read." },
      guard(async () => ok(await loadOverview(token.scopes))),
    );
    server.registerTool(
      "get_week_summary",
      { description: "The last seven local calendar days: mood average, caffeine, supplement days, sleep, event count and spending. Fields the key cannot read are empty or zero." },
      guard(async () => ok(await loadWeekSummary(token.scopes))),
    );
  }

  if (has("log:read")) {
    server.registerTool(
      "get_profile",
      { description: "Who the owner is: name, physical details, life context and notes for agents. Empty fields are omitted. Timezone and age (from date of birth) are included when known." },
      guard(async () => ok(profileForAgents(await loadProfile()))),
    );
    server.registerTool("get_today", { description: "Today's mood, caffeine and supplements as logged in Life Stack." }, guard(async () => {
      const { date, summary } = await loadToday();
      return ok({
        date,
        mood: summary.mood && { value: summary.mood.value, at: summary.mood.at.toISOString(), count: summary.mood.count },
        caffeine: { count: summary.caffeine.count, mg: summary.caffeine.mg, lastAt: summary.caffeine.lastAt?.toISOString() ?? null },
        supplements: summary.supplements.map((s) => ({ name: s.name, count: s.count, lastAt: s.lastAt.toISOString() })),
      });
    }));
  }

  if (has("log:write")) {
    server.registerTool(
      "log_event",
      {
        description: "Log a mood (value 1-5), a caffeine drink (drink, optional mg) or a supplement taken (name). Optional 'at' (ISO time, up to 30 days back) and 'id' (8-64 letters/numbers; a retry with the same id never logs twice).",
        inputSchema: {
          type: z.enum(["mood", "caffeine", "supplement"]),
          value: z.number().optional(),
          note: z.string().optional(),
          drink: z.string().optional(),
          mg: z.number().optional(),
          name: z.string().optional(),
          at: z.string().optional(),
          id: z.string().optional(),
        },
      },
      async (args) => {
        const parsed = EventInput.safeParse(args);
        if (!parsed.success) return fail(`Invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
        try {
          const r = await insertLog(parsed.data, "agent");
          if (!r.ok) return fail(`Invalid: at ${r.error}`);
          return ok({ id: r.id, ts: r.ts.toISOString(), created: r.created });
        } catch (e) {
          console.error("mcp: could not log", describeError(e));
          return fail("Could not save the entry.");
        }
      },
    );
  }

  if (has("calendar:read")) {
    server.registerTool(
      "get_calendar",
      {
        description: `Calendar events and holidays between two dates (YYYY-MM-DD, inclusive; default today to 14 days ahead; at most ${MAX_RANGE_DAYS} days).`,
        inputSchema: { from: Day.optional(), to: Day.optional() },
      },
      async ({ from, to }) => {
        const start = from ?? ymd(new Date());
        const end = to ?? addDays(start, 14);
        if (end < start) return fail("'to' is before 'from'.");
        if (addDays(start, MAX_RANGE_DAYS) < end) return fail(`Range is limited to ${MAX_RANGE_DAYS} days.`);
        try {
          const items = await calendarItems(startOfDay(start), startOfDay(addDays(end, 1)));
          return ok(items.map((i) => ({ title: i.title, start: i.allDay ? ymd(i.start) : i.start.toISOString(), end: i.allDay ? ymd(i.end) : i.end.toISOString(), allDay: i.allDay, kind: i.kind, location: i.location ?? null })));
        } catch (e) {
          console.error("mcp: calendar failed", describeError(e));
          return fail("The tool could not read the data.");
        }
      },
    );
  }

  if (has("sleep:read")) {
    server.registerTool(
      "get_sleep",
      { description: "Recent nights of sleep (score, stages, HRV, time in bed), newest first.", inputSchema: { nights: z.number().int().min(1).max(60).optional() } },
      async ({ nights }) => {
        try {
          const rows = await loadNights(nights ?? 14);
          return ok(rows.map(({ sessions: _s, ...n }) => n));
        } catch (e) {
          console.error("mcp: sleep failed", describeError(e));
          return fail("The tool could not read the data.");
        }
      },
    );
  }

  if (has("finance:read")) {
    server.registerTool("get_finance_summary", { description: "Net worth, balances by group, this and last month's income, spending and top categories, and plain-language insights. Amounts are in dollars; spending is positive." }, guard(async () => {
      const f = await loadFinance();
      if (!f.ok) return fail("Finance data is unavailable.");
      const month = monthOf(f.today);
      const nw = netWorth(f.accounts);
      return ok({
        today: f.today,
        netWorth: { assets: nw.assets, liabilities: nw.liabilities, net: nw.net },
        groups: nw.groups.map((g) => ({ label: g.label, total: g.total, accounts: g.accounts.map((a) => ({ name: accountLabel(a), institution: a.institution, subtype: a.subtype, balance: a.current })) })),
        thisMonth: summarizeMonth(f.txns, month),
        lastMonth: summarizeMonth(f.txns, shiftMonthKey(month, -1)),
        insights: insights({ txns: f.txns, accounts: f.accounts, liabilities: f.liabilities, today: f.today }).map((i) => `${i.title}: ${i.detail}`),
        note: `Net worth ${fmtMoney(nw.net)}.`,
      });
    }));

    server.registerTool(
      "get_transactions",
      {
        description: "Search transactions (newest first). Positive amounts are money out, negative are money in. Filters: text (merchant or name), from/to (YYYY-MM-DD), category, limit (max 100).",
        inputSchema: { text: z.string().max(80).optional(), from: Day.optional(), to: Day.optional(), category: z.string().max(60).optional(), limit: z.number().int().min(1).max(100).optional() },
      },
      async ({ text, from, to, category, limit }) => {
        const f = await loadFinance();
        if (!f.ok) return fail("Finance data is unavailable.");
        const q = text?.trim().toLowerCase();
        const rows = f.txns
          .filter((t) => (!q || merchantName(t).toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) && (!from || t.date >= from) && (!to || t.date <= to) && (!category || t.category === category))
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
          .slice(0, limit ?? 25);
        return ok(rows.map((t) => ({ date: t.date, merchant: merchantName(t), amount: t.amount, category: t.category, kind: classify(t), pending: t.pending })));
      },
    );

    server.registerTool("get_holdings", { description: "Investment positions from the newest snapshot of each brokerage account: symbol, quantity, price, value, cost basis." }, guard(async () => {
      const rows = await loadHoldings();
      return ok(rows.map(({ accountId: _a, ...h }) => h));
    }));
  }

  return server;
}
