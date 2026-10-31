import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AGENT_SCOPES, EventInput, type Scope } from "./capture-core";
import { insertLog, loadToday } from "./capture";
import { loadOverview, loadWeekSummary } from "./overview";
import { calendarItems } from "./calendar";
import { addDays, isValidDay, startOfDay, ymd } from "./dates";
import { describeError } from "./errors";
import { classify, fmtMoney, insights, merchantName, monthOf, netWorth, shiftMonthKey, summarizeMonth, accountLabel } from "./finance-calc";
import { loadFinance, loadHoldings } from "./finance-data";
import { loadProfile, profileForAgents } from "./profile";
import { loadNights } from "./sleep";
import { loadActivities, totals } from "./activities";
import { getEmail, loadAgenda, searchEmails } from "./email";
import { addPlace, loadHistory } from "./location";
import { getNote, kickSync, searchNotes } from "./notes";
import { changeSetting, listSettings, resetSetting } from "./settings";
import { afterResponse, appendToNotebook, ensureNotebook, notebookHook } from "./goals-notion";
import { logBlocks } from "./goals-notion-core";
import { commitPlan, completeSession, createGoal, findFreeTime, getGoal, listGoals, moveSession, proposePlan, pushToCalendar, skipSession, tonight, updateGoal } from "./goals";
import { addTodo, listTodos, updateTodo } from "./todos";
import { addOption, addWant, listWants, updateOption } from "./wants";
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

  if (has("log:read")) {
    server.registerTool(
      "get_todos",
      { description: "The owner's to-do list, shared across every agent session. Open items first (soonest due, then oldest), then done and dropped. Each has id, title, note, status open/done/dropped, due (YYYY-MM-DD or null) and who added it. Check it at the start of a session and before saying something is not on the list." },
      guard(async () => ok(await listTodos())),
    );
    server.registerTool(
      "get_wants",
      { description: "The owner's Wants list for deal hunting. Each want (a thing or a kind of thing, e.g. a jacket) has candidate options with link, latest price and target price in cents, atTarget (price at or under target) and status; only one option per want is ever bought. Newest first." },
      guard(async () => ok(await listWants())),
    );
  }

  if (has("log:write")) {
    server.registerTool(
      "add_todo",
      {
        description: "Add an item to the owner's to-do list so it survives this session. Title, optional note and optional due date (YYYY-MM-DD). Returns the todo id. Check get_todos first to avoid duplicates.",
        inputSchema: { title: z.string(), note: z.string().optional(), due: z.string().optional() },
      },
      async (args) => {
        try {
          const r = await addTodo(args, "agent");
          return r.ok ? ok({ id: r.id }) : fail(`Invalid: ${r.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
        } catch (e) {
          console.error("mcp: add_todo failed", describeError(e));
          return fail("The tool could not save that.");
        }
      },
    );
    server.registerTool(
      "update_todo",
      {
        description: "Change a to-do: mark it done, dropped or open again, or edit its title, note or due date (empty string clears a note or date). Mark items done when the work is finished and verified.",
        inputSchema: { todoId: z.number().int(), status: z.enum(["open", "done", "dropped"]).optional(), title: z.string().optional(), note: z.string().optional(), due: z.string().optional() },
      },
      async ({ todoId, ...rest }) => {
        try {
          const r = await updateTodo(todoId, rest);
          if (!r.ok) return fail(`Invalid: ${r.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
          return r.found ? ok({ ok: true }) : fail("No such todo.");
        } catch (e) {
          console.error("mcp: update_todo failed", describeError(e));
          return fail("The tool could not save that.");
        }
      },
    );
    server.registerTool(
      "add_want",
      {
        description: "Add something to the owner's Wants list. Optionally include one first option (link, price in dollars, target price in dollars). Returns the want id.",
        inputSchema: { title: z.string(), note: z.string().optional(), budget: z.number().optional(), option: z.object({ url: z.string().optional(), price: z.number().optional(), target: z.number().optional() }).optional() },
      },
      async ({ option, ...rest }) => {
        try {
          const r = await addWant({ ...rest, first: option });
          return r.ok ? ok({ id: r.id }) : fail(`Invalid: ${r.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
        } catch (e) {
          console.error("mcp: add_want failed", describeError(e));
          return fail("The tool could not save that.");
        }
      },
    );
    server.registerTool(
      "add_want_option",
      {
        description: "Add a candidate option (title, optional link, price and target price in dollars) to an existing want.",
        inputSchema: { wantId: z.number().int(), title: z.string(), url: z.string().optional(), price: z.number().optional(), target: z.number().optional(), note: z.string().optional() },
      },
      async ({ wantId, ...rest }) => {
        try {
          const r = await addOption(wantId, rest);
          if (r.ok) return ok({ id: r.id });
          return fail("notFound" in r ? "No such want." : `Invalid: ${r.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
        } catch (e) {
          console.error("mcp: add_want_option failed", describeError(e));
          return fail("The tool could not save that.");
        }
      },
    );
    server.registerTool(
      "update_want_option",
      {
        description: "Record a price seen for a want option (dollars; stamps the check time), change its target, or set status considering/rejected. Use this when you find a deal. Never marks something bought; the owner does that.",
        inputSchema: { optionId: z.number().int(), price: z.number().optional(), target: z.number().optional(), status: z.enum(["considering", "rejected"]).optional(), note: z.string().optional() },
      },
      async ({ optionId, ...rest }) => {
        try {
          const r = await updateOption(optionId, rest);
          if (!r.ok) return fail(`Invalid: ${r.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
          return r.found ? ok({ ok: true }) : fail("No such option.");
        } catch (e) {
          console.error("mcp: update_want_option failed", describeError(e));
          return fail("The tool could not save that.");
        }
      },
    );
    server.registerTool(
      "log_event",
      {
        description: "Log a mood (value 1-5), a caffeine drink (drink, optional mg) or a supplement taken (name). Optional 'at' (ISO time, any past day) and 'id' (8-64 letters/numbers; a retry with the same id never logs twice).",
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

  if (has("email:read")) {
    server.registerTool(
      "search_email",
      {
        description: "Search the owner's Outlook mail (inbox, archive, sent), newest first. Filters: q (subject or body text), from (name or address), category (receipt, shipping, bill, appointment, deal, other), since and until (YYYY-MM-DD). Returns a snippet per message and any extracted facts (merchant, amountCents, tracking, dueDate, eventDate); use get_email for the full text.",
        inputSchema: { q: z.string().optional(), from: z.string().optional(), category: z.enum(["receipt", "shipping", "bill", "appointment", "deal", "other"]).optional(), since: Day.optional(), until: Day.optional(), limit: z.number().int().min(1).max(50).optional() },
      },
      async (args) => {
        try {
          return ok(await searchEmails(args));
        } catch (e) {
          console.error("mcp: search_email failed", describeError(e));
          return fail("The tool could not read the data.");
        }
      },
    );
    server.registerTool(
      "get_email",
      { description: "The full plain text of one message by id (from search_email).", inputSchema: { id: z.number().int() } },
      async ({ id }) => {
        try {
          const e = await getEmail(id);
          return e ? ok(e) : fail("No such message.");
        } catch (e) {
          console.error("mcp: get_email failed", describeError(e));
          return fail("The tool could not read the data.");
        }
      },
    );
    server.registerTool(
      "get_agenda",
      { description: "Upcoming bills (due dates), appointments and deliveries found in the last 90 days of mail, soonest first." },
      guard(async () => ok(await loadAgenda())),
    );
  }

  if (has("location:read")) {
    server.registerTool(
      "get_location_history",
      {
        description: "Where the owner has been: stays (arrival, departure, minutes, coordinates, and the name of a saved place when one matches), the latest reported point (with ageMinutes: it is not live, the phone reports on arrival, a big move, or when the app opens), and the saved places. Newest stays first.",
        inputSchema: { days: z.number().int().min(1).max(365).optional() },
      },
      async ({ days }) => {
        try {
          return ok(await loadHistory(days ?? 7));
        } catch (e) {
          console.error("mcp: location failed", describeError(e));
          return fail("The tool could not read the data.");
        }
      },
    );
  }

  if (has("location:write")) {
    server.registerTool(
      "name_place",
      {
        description: "Save a named place (for example home or the gym) at coordinates, so stays there are labelled. Radius in metres, 20 to 2000, default 100.",
        inputSchema: { label: z.string(), lat: z.number(), lon: z.number(), radiusM: z.number().int().optional() },
      },
      async (args) => {
        try {
          const r = await addPlace(args);
          return r.ok ? ok({ id: r.id }) : fail("Invalid place.");
        } catch (e) {
          console.error("mcp: name_place failed", describeError(e));
          return fail("The tool could not save that.");
        }
      },
    );
  }

  if (has("notes:read")) {
    server.registerTool(
      "search_notes",
      {
        description: "Search the owner's shared Notion pages (title and text), most recently edited first. Returns a snippet per page; use get_note for the text. Only pages shared with the integration are copied, the text is capped, and files are omitted.",
        inputSchema: { q: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
      },
      async (args) => {
        try {
          kickSync();
          return ok(await searchNotes(args));
        } catch (e) {
          console.error("mcp: search_notes failed", describeError(e));
          return fail("The tool could not read the data.");
        }
      },
    );
    server.registerTool(
      "get_note",
      { description: "The text of one Notion page by id (from search_notes), capped at 6,000 characters.", inputSchema: { id: z.number().int() } },
      async ({ id }) => {
        try {
          const n = await getNote(id);
          return n ? ok(n) : fail("No such note.");
        } catch (e) {
          console.error("mcp: get_note failed", describeError(e));
          return fail("The tool could not read the data.");
        }
      },
    );
  }

  if (has("settings:read")) {
    server.registerTool(
      "get_settings",
      { description: "The preferences that can be changed without a deploy: each with a description, its current value, its default and whether it was customised. Includes the mail sorting rules, the web map defaults and the iPhone app's trip mode tuning." },
      guard(async () => ok(await listSettings())),
    );
  }

  if (has("settings:write")) {
    server.registerTool(
      "set_setting",
      {
        description: "Change one preference (key and value from get_settings). The value is validated against that setting; an invalid one is refused. Changing email.rules re-sorts existing mail. Web changes show on the next page load and iPhone app changes the next time the app opens.",
        inputSchema: { key: z.string(), value: z.unknown() },
      },
      async ({ key, value }) => {
        try {
          const r = await changeSetting(key, value);
          return r.ok ? ok({ setting: r.view, effects: r.effects }) : fail(`Invalid: ${r.error}`);
        } catch (e) {
          console.error("mcp: set_setting failed", describeError(e));
          return fail("The tool could not save that.");
        }
      },
    );
    server.registerTool(
      "reset_setting",
      { description: "Put one preference back to its built-in default.", inputSchema: { key: z.string() } },
      async ({ key }) => {
        try {
          const r = await resetSetting(key);
          return r.ok ? ok({ setting: r.view, effects: r.effects }) : fail(`Invalid: ${r.error}`);
        } catch (e) {
          console.error("mcp: reset_setting failed", describeError(e));
          return fail("The tool could not save that.");
        }
      },
    );
  }

  if (has("goals:read")) {
    server.registerTool(
      "get_goals",
      { description: "The owner's goals (a thing they are working toward, with a thesis and a date or pace), each with its planned, done and skipped session counts, and the next session." },
      guard(async () => ok(await Promise.all((await listGoals()).map(async (g) => (await getGoal(g.id))!)))),
    );
    server.registerTool(
      "get_goal",
      { description: "One goal with every session (planned, done, skipped).", inputSchema: { id: z.string() } },
      async ({ id }) => {
        try {
          const g = await getGoal(id);
          return g ? ok(g) : fail("No such goal.");
        } catch (e) {
          console.error("mcp: get_goal failed", describeError(e));
          return fail("The tool could not read the data.");
        }
      },
    );
    server.registerTool(
      "find_free_time",
      {
        description: "Stretches of real free time in the owner's calendar over the next few days, inside the hours they allow for goal sessions (weekday evenings and weekend days by default, never after the latest end), clear of meetings and of sessions already planned. Use it to see what is possible before proposing a plan.",
        inputSchema: { days: z.number().int().min(1).max(60).optional(), minMinutes: z.number().int().min(10).max(480).optional() },
      },
      async ({ days, minMinutes }) => {
        try {
          const from = new Date();
          const { free } = await findFreeTime({ from, to: new Date(from.getTime() + (days ?? 14) * 86_400_000), minMin: minMinutes ?? 30 });
          return ok(free.map((f) => ({ start: f.start.toISOString(), end: f.end.toISOString(), minutes: Math.round((f.end.getTime() - f.start.getTime()) / 60000) })));
        } catch (e) {
          console.error("mcp: find_free_time failed", describeError(e));
          return fail("The tool could not read the data.");
        }
      },
    );
    server.registerTool(
      "propose_plan",
      {
        description:
          'Drafts the sessions for a goal and fits them into real free time. It saves nothing, so call it as often as you like while brainstorming and show the owner the result. kind "prep": counts back from targetDay (a date, YYYY-MM-DD) with a session every everyDays days (default 2) of durationMin minutes (default 60), the last taperLast ones lighter. kind "progress": a session each day (or only the listed weekdays, Monday is 0) from fromDay (default today) to targetDay. kind "train": a weekly template of {weekday, durationMin, title}, scaled week by week (builds up, steps back every fourth week, tapers the last two) until targetDay. kind "custom": an explicit list of sessions [{day, durationMin, title, flexDays}]. Every plan and every template slot or custom session can take a start ("HH:MM", local) to say when in the free time it likes to begin, such as "09:00" for a morning long run or "18:30" for an evening one; without it sessions start at the general preference (about 7pm). Returns the placed sessions, any that did not fit with the reason, and a feasibility summary (minutes needed, available, short by).',
        inputSchema: {
          kind: z.enum(["prep", "progress", "train", "custom"]),
          title: z.string(),
          fromDay: z.string().optional(),
          targetDay: z.string().optional(),
          everyDays: z.number().int().optional(),
          durationMin: z.number().int().optional(),
          taperLast: z.number().int().optional(),
          weekdays: z.array(z.number().int()).optional(),
          weeks: z.number().int().optional(),
          start: z.string().optional(),
          template: z.array(z.object({ weekday: z.number().int(), durationMin: z.number().int(), title: z.string(), start: z.string().optional() })).optional(),
          sessions: z.array(z.object({ day: z.string(), durationMin: z.number().int(), title: z.string(), flexDays: z.number().int().optional(), start: z.string().optional() })).optional(),
          flexDays: z.number().int().optional(),
        },
      },
      async (args) => {
        try {
          const r = await proposePlan(args);
          return r.ok ? ok(r) : fail(r.error);
        } catch (e) {
          console.error("mcp: propose_plan failed", describeError(e));
          return fail("The tool could not build that plan.");
        }
      },
    );
    server.registerTool(
      "get_tonight",
      { description: "Today's sessions, anything that slipped and needs a decision (each with the slot it would move to, or null when there is no room), and how many free minutes are left today. This is what to open with when the owner asks what to do tonight." },
      guard(async () => ok(await tonight())),
    );
  }

  if (has("goals:write")) {
    const fromResult = <T extends { ok: boolean }>(r: T) => ((r as { ok: boolean }).ok ? ok(r) : fail((r as unknown as { error: string }).error));
    server.registerTool(
      "create_goal",
      {
        description: 'Starts a goal. thesis is why it matters and what done looks like, in the owner\'s words. kind is prep, progress, train or custom. targetDay is YYYY-MM-DD. mode says what happens when a session slips: "ask" (default, nothing moves without the owner), "slide" or "auto". Creating a goal schedules nothing; build the sessions with propose_plan and commit_plan.',
        inputSchema: { title: z.string(), thesis: z.string().optional(), kind: z.enum(["prep", "progress", "train", "custom"]).optional(), targetDay: z.string().optional(), mode: z.enum(["ask", "slide", "auto"]).optional(), config: z.record(z.string(), z.unknown()).optional() },
      },
      async (args) => {
        try {
          const r = await createGoal(args);
          if (!r.ok) return fail(r.error);
          return ok({ ...r, notebook: await ensureNotebook(r.goal.id) }); // a Notion notebook for the goal, if Notion is ready for it
        } catch (e) { console.error("mcp: create_goal failed", describeError(e)); return fail("The tool could not save that."); }
      },
    );
    server.registerTool(
      "update_goal",
      {
        description: "Changes a goal: title, thesis, kind, targetDay (or null), mode, status (draft, active, done, archived), config.",
        inputSchema: { id: z.string(), title: z.string().optional(), thesis: z.string().optional(), kind: z.enum(["prep", "progress", "train", "custom"]).optional(), targetDay: z.string().nullable().optional(), mode: z.enum(["ask", "slide", "auto"]).optional(), status: z.enum(["draft", "active", "done", "archived"]).optional(), config: z.record(z.string(), z.unknown()).optional() },
      },
      async ({ id, ...patch }) => {
        try { return fromResult(await updateGoal(id, patch)); } catch (e) { console.error("mcp: update_goal failed", describeError(e)); return fail("The tool could not save that."); }
      },
    );
    server.registerTool(
      "commit_plan",
      {
        description: "Saves the finalized sessions for a goal and adds them to the owner's Outlook calendar (in the Life Stack category). Only call this after the owner has approved the plan. Each session is {title, start, end, note} with ISO times, normally taken from propose_plan. If anything overlaps a meeting or another session nothing is saved and the conflicts are listed. If Outlook has not been reconnected to allow writing the sessions are still saved here and calendar says needs_reconnect; run push_to_calendar after the owner reconnects.",
        inputSchema: { goalId: z.string(), sessions: z.array(z.object({ title: z.string(), start: z.string(), end: z.string(), note: z.string().optional() })), allowOverlap: z.boolean().optional() },
      },
      async ({ goalId, ...rest }) => {
        try {
          const r = await commitPlan(goalId, rest);
          if (r.ok) afterResponse(() => notebookHook({ type: "committed", goalId, sessions: r.sessions.map((x) => ({ title: x.title, start: x.start, minutes: x.minutes })) }));
          return fromResult(r);
        } catch (e) { console.error("mcp: commit_plan failed", describeError(e)); return fail("The tool could not save that."); }
      },
    );
    server.registerTool(
      "create_notebook",
      { description: "Creates the goal's Notion notebook if it does not have one yet (a page under the owner's Goals page with the thesis, a Brainstorm section and a Log). create_goal already tries this; use it to retry after the owner fixes Notion. Returns the notebook link, or what the owner needs to switch on.", inputSchema: { goalId: z.string() } },
      async ({ goalId }) => {
        try { return ok(await ensureNotebook(goalId)); } catch (e) { console.error("mcp: create_notebook failed", describeError(e)); return fail("The tool could not reach Notion."); }
      },
    );
    server.registerTool(
      "notebook_note",
      { description: "Adds a dated line to the goal's Notion notebook, at the end of the page (the log). Use it to record what was decided while brainstorming: ideas, constraints, a changed plan. Prefix the text with what it is, such as 'Idea:' or 'Decision:'.", inputSchema: { goalId: z.string(), text: z.string() } },
      async ({ goalId, text }) => {
        try {
          const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date());
          const state = await appendToNotebook(goalId, logBlocks(day, text.slice(0, 3800)));
          return state === "ok" ? ok({ state }) : fail(`The note was not added (${state}). ${state === "no_notebook" ? "Run create_notebook first." : ""}`.trim());
        } catch (e) { console.error("mcp: notebook_note failed", describeError(e)); return fail("The tool could not reach Notion."); }
      },
    );
    server.registerTool(
      "push_to_calendar",
      { description: "Adds calendar events for sessions that were saved without one (for example before Outlook was reconnected). Optionally for one goal.", inputSchema: { goalId: z.string().optional() } },
      async ({ goalId }) => {
        try { return ok(await pushToCalendar(goalId)); } catch (e) { console.error("mcp: push_to_calendar failed", describeError(e)); return fail("The tool could not update the calendar."); }
      },
    );
    server.registerTool(
      "complete_session",
      { description: "Marks a session done. Optionally the minutes actually spent, a note about what was covered, and a 1 to 5 rating of how it went.", inputSchema: { id: z.string(), minutes: z.number().int().optional(), note: z.string().optional(), rating: z.number().int().optional() } },
      async ({ id, ...rest }) => {
        try {
          const r = await completeSession(id, rest);
          if (r.ok) afterResponse(() => notebookHook({ type: "done", session: r.session, note: rest.note }));
          return fromResult(r);
        } catch (e) { console.error("mcp: complete_session failed", describeError(e)); return fail("The tool could not save that."); }
      },
    );
    server.registerTool(
      "skip_session",
      { description: "Skips a session: it stays in the record and comes off the calendar.", inputSchema: { id: z.string() } },
      async ({ id }) => {
        try {
          const r = await skipSession(id);
          if (r.ok) afterResponse(() => notebookHook({ type: "skipped", session: r.session }));
          return fromResult(r);
        } catch (e) { console.error("mcp: skip_session failed", describeError(e)); return fail("The tool could not save that."); }
      },
    );
    server.registerTool(
      "move_session",
      { description: "Moves a planned session, and its calendar event. Give start (an ISO time) to pick the time, or leave it out to use the next free slot. Refuses an overlap, and says plainly when there is no slot before the goal's last day.", inputSchema: { id: z.string(), start: z.string().optional() } },
      async ({ id, start }) => {
        try {
          const r = await moveSession(id, { start });
          if (r.ok) afterResponse(() => notebookHook({ type: "moved", session: r.session }));
          return fromResult(r);
        } catch (e) { console.error("mcp: move_session failed", describeError(e)); return fail("The tool could not save that."); }
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

  if (has("fitness:read")) {
    server.registerTool(
      "get_activities",
      {
        description: "Workouts from Strava (runs, rides, swims and so on), newest first, with totals. Distances are metres, times seconds, speeds metres per second. Filters: from/to (YYYY-MM-DD), sport (for example Run), limit (max 200).",
        inputSchema: { from: Day.optional(), to: Day.optional(), sport: z.string().max(40).optional(), limit: z.number().int().min(1).max(200).optional() },
      },
      async ({ from, to, sport, limit }) => {
        if (from && to && to < from) return fail("'to' is before 'from'.");
        try {
          const list = await loadActivities({ from: from ? new Date(`${from}T00:00:00Z`) : undefined, to: to ? new Date(`${addDays(to, 1)}T00:00:00Z`) : undefined, sport, limit: limit ?? 30 });
          return ok({ activities: list, totals: totals(list) });
        } catch (e) {
          console.error("mcp: activities failed", describeError(e));
          return fail("The tool could not read the data.");
        }
      },
    );
  }

  return server;
}

// Every tool the server can offer, for the usage page to show which ones never get called.
export function offeredTools(): string[] {
  const s = buildServer({ id: 0, kind: "agent", scopes: [...AGENT_SCOPES], userId: null });
  return Object.keys((s as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools ?? {}).sort();
}
