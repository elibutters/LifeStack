import "server-only";
import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { connections, emails, syncState } from "@lifestack/db";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { todayInTz } from "./dates";
import { describeError } from "./errors";
import { agendaOf, CATEGORIES, classify, snippet, tidyBody, type Extracted } from "./email-core";
import { GRAPH, graphGet, MAIL_SCOPES, refreshTokens, TokenError } from "./microsoft";
import { verifyBearer } from "./tokens";

const SOURCE = "outlook-mail";
const FOLDERS = ["inbox", "archive", "sentitems"] as const;
const PAGE = 50;
const NEEDS_RELINK = "Reconnect Outlook on the Connections page to allow mail access.";

type FolderCursor = { newest?: string; oldest?: string; done?: boolean };
type Cursor = Partial<Record<(typeof FOLDERS)[number], FolderCursor>>;

const Msg = z.object({
  id: z.string(),
  subject: z.string().nullish(),
  receivedDateTime: z.string(),
  isRead: z.boolean().nullish(),
  hasAttachments: z.boolean().nullish(),
  conversationId: z.string().nullish(),
  from: z.object({ emailAddress: z.object({ name: z.string().nullish(), address: z.string().nullish() }) }).nullish(),
  body: z.object({ content: z.string().nullish() }).nullish(),
});
const Page = z.object({ value: z.array(z.unknown()), "@odata.nextLink": z.string().optional() });

export function toEmailRow(raw: unknown, folder: string): typeof emails.$inferInsert | null {
  const m = Msg.safeParse(raw);
  if (!m.success) return null;
  const receivedAt = new Date(m.data.receivedDateTime);
  if (Number.isNaN(receivedAt.getTime())) return null;
  const subject = (m.data.subject ?? "").slice(0, 300);
  const body = m.data.body?.content ?? "";
  const fromName = m.data.from?.emailAddress.name ?? null;
  const { category, extracted } = classify({ fromName, subject, body, receivedAt });
  return {
    sourceId: m.data.id,
    folder,
    receivedAt,
    fromName: fromName?.slice(0, 120) ?? null,
    fromAddress: m.data.from?.emailAddress.address?.slice(0, 200) ?? null,
    subject,
    bodyText: tidyBody(body, category),
    isRead: m.data.isRead ?? false,
    hasAttachments: m.data.hasAttachments ?? false,
    conversationId: m.data.conversationId ?? null,
    category,
    extracted: extracted as Record<string, unknown>,
  };
}

async function claimLease(): Promise<boolean> {
  await db().insert(syncState).values({ source: SOURCE }).onConflictDoNothing();
  const r = await db()
    .update(syncState)
    .set({ leaseUntil: sql`now() + interval '5 minutes'` })
    .where(and(eq(syncState.source, SOURCE), sql`(${syncState.leaseUntil} is null or ${syncState.leaseUntil} < now())`))
    .returning({ source: syncState.source });
  return r.length > 0;
}

const record = (set: { lastOkAt?: Date; lastError?: string | null; cursor?: string }) =>
  db().insert(syncState).values({ source: SOURCE, ...set }).onConflictDoUpdate({ target: syncState.source, set });

export type MailSync = { stored: number; done: boolean } | { skipped: true } | null;

// Reads new mail, then keeps working backwards through history until the time budget runs out. Re-running
// never duplicates a message. Mail deleted in Outlook is not removed here.
export async function syncMail(budgetMs = 40_000): Promise<MailSync> {
  const started = Date.now();
  const [conn] = await db().select().from(connections).where(eq(connections.provider, "outlook"));
  if (!conn) return null;
  if (!(await claimLease())) return { skipped: true };
  try {
    let tokens;
    try {
      tokens = await refreshTokens(decrypt(conn.refreshTokenEnc), MAIL_SCOPES);
    } catch (e) {
      if (e instanceof TokenError) {
        await record({ lastError: NEEDS_RELINK });
        return null;
      }
      throw e;
    }
    let current = conn.refreshTokenEnc;
    if (tokens.refresh_token) {
      const next = encrypt(tokens.refresh_token);
      const upd = await db()
        .update(connections)
        .set({ refreshTokenEnc: next, updatedAt: new Date() })
        .where(and(eq(connections.provider, "outlook"), eq(connections.refreshTokenEnc, conn.refreshTokenEnc)))
        .returning({ p: connections.provider });
      if (upd.length === 0) return null;
      current = next;
    }

    const [st] = await db().select().from(syncState).where(eq(syncState.source, SOURCE));
    const cursor: Cursor = (() => {
      try {
        return st?.cursor ? (JSON.parse(st.cursor) as Cursor) : {};
      } catch {
        return {};
      }
    })();
    let stored = 0;

    const pull = async (folder: (typeof FOLDERS)[number], filter: string | null, pages: number): Promise<{ rows: number; newest?: string; oldest?: string; more: boolean }> => {
      const qs = new URLSearchParams({
        $select: "id,subject,from,receivedDateTime,isRead,hasAttachments,conversationId,body",
        $orderby: "receivedDateTime desc",
        $top: String(PAGE),
        ...(filter ? { $filter: filter } : {}),
      });
      let next: string | undefined = `${GRAPH}/me/mailFolders/${folder}/messages?${qs}`;
      let rows = 0, newest: string | undefined, oldest: string | undefined, more = false;
      for (let i = 0; next && i < pages; i++) {
        if (Date.now() - started > budgetMs) { more = true; break; }
        const body = Page.parse(await graphGet(next, tokens.access_token, 'outlook.body-content-type="text"'));
        const batch = body.value.map((r) => toEmailRow(r, folder)).filter((r): r is NonNullable<typeof r> => !!r);
        if (batch.length) {
          const ok = await db().transaction(async (tx) => {
            const [live] = await tx.select({ enc: connections.refreshTokenEnc }).from(connections).where(eq(connections.provider, "outlook")).for("share");
            if (!live || live.enc !== current) return false;
            await tx.insert(emails).values(batch).onConflictDoUpdate({
              target: emails.sourceId,
              set: {
                folder: sql`excluded.folder`, isRead: sql`excluded.is_read`, subject: sql`excluded.subject`, bodyText: sql`excluded.body_text`,
                category: sql`excluded.category`, extracted: sql`excluded.extracted`, hasAttachments: sql`excluded.has_attachments`,
              },
            });
            return true;
          });
          if (!ok) throw new Error("connection changed during sync");
          rows += batch.length;
          for (const r of batch) {
            const t = r.receivedAt!.toISOString();
            if (!newest || t > newest) newest = t;
            if (!oldest || t < oldest) oldest = t;
          }
        }
        next = body["@odata.nextLink"];
        if (next) more = true; else more = false;
      }
      return { rows, newest, oldest, more };
    };

    for (const folder of FOLDERS) {
      const c: FolderCursor = cursor[folder] ?? {};
      // New mail since the last run (with a day of overlap for read-state changes).
      if (c.newest) {
        const since = new Date(Date.parse(c.newest) - 86_400_000).toISOString();
        const r = await pull(folder, `receivedDateTime ge ${since}`, 10);
        stored += r.rows;
        if (r.newest && r.newest > c.newest) c.newest = r.newest;
      }
      // Older history, newest first, until done or out of time.
      while (!c.done && Date.now() - started < budgetMs) {
        const r = await pull(folder, c.oldest ? `receivedDateTime lt ${c.oldest}` : null, 4);
        stored += r.rows;
        if (r.newest && (!c.newest || r.newest > c.newest)) c.newest = r.newest;
        if (r.oldest) c.oldest = r.oldest;
        if (!r.more) c.done = true;
      }
      cursor[folder] = c;
    }
    const done = FOLDERS.every((f) => cursor[f]?.done);
    await record({ lastOkAt: new Date(), lastError: null, cursor: JSON.stringify(cursor) });
    return { stored, done };
  } catch (e) {
    console.error("email: sync failed", describeError(e));
    await record({ lastError: "Mail sync failed. It will retry." }).catch(() => {});
    throw e;
  } finally {
    await db().update(syncState).set({ leaseUntil: null }).where(eq(syncState.source, SOURCE)).catch(() => {});
  }
}

// ---- reading

export type EmailBrief = { id: number; receivedAt: string; folder: string; from: string | null; fromAddress: string | null; subject: string; category: string; isRead: boolean; extracted: Extracted; snippet: string };

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const SearchInput = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(CATEGORIES).optional(),
  from: z.string().trim().max(100).optional(),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchArgs = z.input<typeof SearchInput>;

export async function searchEmails(input: SearchArgs): Promise<EmailBrief[]> {
  const a = SearchInput.parse(input);
  const where = [
    a.category ? eq(emails.category, a.category) : undefined,
    a.since ? gte(emails.receivedAt, new Date(`${a.since}T00:00:00Z`)) : undefined,
    a.until ? lt(emails.receivedAt, new Date(`${a.until}T00:00:00Z`)) : undefined,
    a.from ? or(ilike(emails.fromName, `%${likeEscape(a.from)}%`), ilike(emails.fromAddress, `%${likeEscape(a.from)}%`)) : undefined,
    a.q ? or(ilike(emails.subject, `%${likeEscape(a.q)}%`), ilike(emails.bodyText, `%${likeEscape(a.q)}%`)) : undefined,
  ].filter((x) => x !== undefined);
  const rows = await db().select().from(emails).where(and(...where)).orderBy(desc(emails.receivedAt)).limit(a.limit);
  return rows.map((r) => ({
    id: r.id, receivedAt: r.receivedAt.toISOString(), folder: r.folder, from: r.fromName, fromAddress: r.fromAddress, subject: r.subject,
    category: r.category, isRead: r.isRead, extracted: r.extracted as Extracted, snippet: snippet(r.bodyText),
  }));
}

export async function getEmail(id: number) {
  const [r] = await db().select().from(emails).where(eq(emails.id, id));
  return r ? { id: r.id, receivedAt: r.receivedAt.toISOString(), folder: r.folder, from: r.fromName, fromAddress: r.fromAddress, subject: r.subject, category: r.category, extracted: r.extracted, body: r.bodyText } : null;
}

export async function loadAgenda(now = new Date()) {
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const rows = await db()
    .select({ id: emails.id, category: emails.category, subject: emails.subject, fromName: emails.fromName, extracted: emails.extracted })
    .from(emails)
    .where(and(inArray(emails.category, ["bill", "appointment", "shipping"]), gte(emails.receivedAt, since)))
    .orderBy(desc(emails.receivedAt))
    .limit(400);
  return agendaOf(rows.map((r) => ({ ...r, extracted: r.extracted as Extracted })), todayInTz(now));
}

export async function mailStatus() {
  const [st] = await db().select().from(syncState).where(eq(syncState.source, SOURCE));
  const [c] = await db().select({ n: sql<number>`count(*)::int` }).from(emails);
  return { stored: c?.n ?? 0, lastOkAt: st?.lastOkAt ?? null, lastError: st?.lastError ?? null };
}

// ---- API (/api/v1/email*), bearer scope email:read

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function guarded(req: Request, fn: () => Promise<Response>): Promise<Response> {
  const auth = await verifyBearer(req.headers.get("authorization"), "email:read");
  if (!auth.ok) return json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, auth.status);
  try {
    return await fn();
  } catch (e) {
    console.error("email: api failed", describeError(e));
    return json({ error: "server_error" }, 500);
  }
}

export const handleEmailSearch = (req: Request) =>
  guarded(req, async () => {
    const p = new URL(req.url).searchParams;
    const parsed = SearchInput.safeParse({
      q: p.get("q") ?? undefined, category: p.get("category") ?? undefined, from: p.get("from") ?? undefined,
      since: p.get("since") ?? undefined, until: p.get("until") ?? undefined, limit: p.get("limit") ? Number(p.get("limit")) : undefined,
    });
    if (!parsed.success) return json({ error: "invalid", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
    return json({ emails: await searchEmails(parsed.data) });
  });

export const handleEmailAgenda = (req: Request) => guarded(req, async () => json({ items: await loadAgenda() }));

export const handleEmailOne = (req: Request, rawId: string) =>
  guarded(req, async () => {
    const id = /^\d{1,15}$/.test(rawId) ? Number(rawId) : 0;
    const e = id ? await getEmail(id) : null;
    return e ? json(e) : json({ error: "not_found" }, 404);
  });
