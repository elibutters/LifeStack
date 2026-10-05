import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConnectionPanel } from "@/components/connection-panel";
import { LastSyncAgo } from "@/components/last-sync-ago";
import { AccountNickname } from "@/components/account-nickname";
import { StatusMark } from "@/components/status-mark";
import { PlaidLinkButton } from "@/components/plaid-link";
import { requireSession } from "@/lib/auth";
import { fmtMoney, isLiability } from "@/lib/finance-calc";
import { listItems } from "@/lib/finance";
import { microsoftConfigured } from "@/lib/microsoft";
import { keyStatus, plaidConfigured, plaidEnv } from "@/lib/plaid";
import { getConnection, getSyncState } from "@/lib/outlook";
import { db } from "@/lib/db";
import { accounts, events } from "@lifestack/db";
import { eq, sql } from "drizzle-orm";
import { disconnect, syncFinance, syncNow, unlinkFinance, connectEight, disconnectEightNow, syncEightNow, disconnectAmazonNow } from "../settings/actions";
import { getEightConnection, getEightSyncState } from "@/lib/eight";
import { loadAmazon } from "@/lib/amazon";
import { LOGIN_REQUIRED } from "@/lib/amazon-map";
import { PageHeader } from "@/components/page-header";
import { loadNightCount } from "@/lib/sleep";

export const metadata: Metadata = { title: "Connections" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS: Record<string, string> = { ok: "Connected", login_required: "Needs you to sign in again", error: "Sync problem" };

const MESSAGES: Record<string, string> = {
  not_configured: "Microsoft app credentials are not set up on this deployment yet.",
  denied: "Microsoft sign-in was cancelled.",
  state: "That sign-in attempt expired or did not match. Try again.",
  exchange: "Microsoft sign-in could not be completed. Try again.",
  eight_auth:
    "Could not sign in to Eight Sleep. Check the email and password. Accounts with two-factor authentication are not supported.",
};

const button = "flex h-9 cursor-pointer items-center rounded-md border border-line px-3 text-sm hover:bg-raised";
const moneyTone = (n: number) => (n > 0 ? "text-ok" : n < 0 ? "text-danger" : "");
const accountKind = (type: string | null, subtype: string | null) => {
  if (subtype) return subtype.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  if (type === "depository") return "Cash";
  if (type === "credit") return "Credit";
  if (type === "investment") return "Investment";
  if (type === "loan") return "Loan";
  return "Account";
};
const danger = `${button} text-danger`;
const field = "h-9 rounded-md border border-line bg-bg px-3 text-sm outline-none focus:border-accent";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const [conn, state, eightConn, eightState, amazon, nightCount, items, acctRows, holdingRows] = await Promise.all([
    getConnection().catch(() => null),
    getSyncState().catch(() => null),
    getEightConnection().catch(() => null),
    getEightSyncState().catch(() => null),
    loadAmazon().catch(() => ({ state: null, orders: [] as { sourceId: string }[], cart: [] as { sourceId: string }[] })),
    loadNightCount().catch(() => 0),
    listItems().catch(() => []),
    loadAcctRows(),
    // Brokerages linked without permission for investment data have accounts but no holdings yet.
    loadHoldingCounts(),
  ]);
  const accountsByItem = new Map<string, typeof acctRows>();
  for (const a of acctRows) {
    if (!a.itemId) continue;
    const list = accountsByItem.get(a.itemId);
    if (list) list.push(a);
    else accountsByItem.set(a.itemId, [a]);
  }
  const holdingCount = new Map(holdingRows.map((r) => [r.itemId, Number(r.n)]));
  const needsInvestmentAccess = (id: string) =>
    (accountsByItem.get(id) ?? []).some((a) => a.type === "investment") && !(holdingCount.get(id) ?? 0);
  const plaidKeys = plaidConfigured() ? await keyStatus() : null;
  // "not configured" is already explained inside the card, so it gets no banner.
  const error = sp.error && sp.error !== "not_configured" ? (MESSAGES[sp.error] ?? "Something went wrong.") : null;

  const amazonLive = Boolean(amazon.state?.lastOkAt || amazon.state?.lastError || amazon.orders.length || amazon.cart.length);
  const amazonLogin = amazon.state?.lastError === LOGIN_REQUIRED;
  const plaidNeedsAttention = !plaidConfigured() || plaidKeys === "rejected" || items.some((it) => it.status !== "ok" || needsInvestmentAccess(it.id));
  let eightImporting = false;
  try {
    const parsed = eightState?.cursor ? (JSON.parse(eightState.cursor) as { backfillBefore?: string | null }) : null;
    eightImporting = typeof parsed?.backfillBefore === "string";
  } catch {
    eightImporting = false;
  }

  return (
    <>
      <PageHeader>
        <h1 className="text-3xl font-semibold tracking-tight">Connections</h1>
      </PageHeader>
      <div className="space-y-3">

      {error && <p className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-danger">{error}</p>}
      {sp.connected === "eight" && !error && (
        <p className="rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-accent">
          Eight Sleep connected. Past nights are importing and will show up on the Sleep tab.
        </p>
      )}
      {sp.connected && sp.connected !== "eight" && !error && (
        <p className="rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-accent">
          Outlook connected. Your calendar is syncing and will appear in a moment.
        </p>
      )}

      <ConnectionPanel
        title="Outlook calendar"
        status={conn ? (state?.lastError ? "Sync problem" : "Connected") : "Not linked"}
        tone={conn ? (state?.lastError ? "bad" : "ok") : "muted"}
        defaultOpen={!conn || Boolean(state?.lastError)}
        meta={conn && state?.lastOkAt ? <LastSyncAgo at={state.lastOkAt.toISOString()} /> : undefined}
        actions={
          conn ? (
            <>
              <form action={syncNow}>
                <button type="submit" className={button}>
                  Sync
                </button>
              </form>
              <a href="/api/connections/outlook/start" className={button}>
                Reconnect
              </a>
              <form action={disconnect}>
                <button type="submit" className={danger}>
                  Disconnect
                </button>
              </form>
            </>
          ) : microsoftConfigured() ? (
            <a href="/api/connections/outlook/start" className={button}>
              Connect
            </a>
          ) : undefined
        }
      >
        {conn ? (
          <>
            <dl>
              <Row label="Account" value={conn.account ?? "Connected"} />
              {state?.lastError && <Row label="Status" value={state.lastError} bad />}
            </dl>
            <p className="text-sm text-muted">
              Disconnecting stops syncing and deletes the copied events. To also withdraw Life Stack's access at Microsoft, remove it at
              account.live.com/consent/Manage.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Link a personal Outlook account (outlook.com, hotmail.com or live.com). The app only reads the calendar; it can never change
              it.
            </p>
            {!microsoftConfigured() && <p className="text-sm text-danger">{MESSAGES.not_configured}</p>}
          </>
        )}
      </ConnectionPanel>

      <ConnectionPanel
        title="Eight Sleep"
        status={eightConn ? (eightState?.lastError ? "Sync problem" : eightImporting ? "Importing" : "Connected") : "Not linked"}
        tone={eightConn ? (eightState?.lastError ? "bad" : eightImporting ? "warn" : "ok") : "muted"}
        defaultOpen={!eightConn || Boolean(eightState?.lastError)}
        meta={eightConn && eightState?.lastOkAt ? <LastSyncAgo at={eightState.lastOkAt.toISOString()} /> : undefined}
        actions={
          eightConn ? (
            <>
              <form action={syncEightNow}>
                <button type="submit" className={button}>
                  Sync
                </button>
              </form>
              <form action={disconnectEightNow}>
                <button type="submit" className={danger}>
                  Disconnect
                </button>
              </form>
            </>
          ) : undefined
        }
      >
        {eightConn ? (
          <dl>
            <Row label="Account" value={eightConn.account ?? "Connected"} />
            <Row label="Nights stored" value={String(nightCount)} />
            {eightImporting && <Row label="History" value="Still importing older nights" />}
            {eightState?.lastError && <Row label="Status" value={eightState.lastError} bad />}
          </dl>
        ) : (
          <>
            <p className="text-sm text-muted">
              Copies nightly scores, stages, heart rate, HRV and time in bed. The pod is never controlled. Two-factor authentication is
              not supported.
            </p>
            <form action={connectEight} className="flex max-w-md flex-col gap-2 sm:flex-row">
              <input type="email" name="email" required autoComplete="username" placeholder="Email" className={`${field} flex-1`} />
              <input type="password" name="password" required autoComplete="current-password" placeholder="Password" className={`${field} flex-1`} />
              <button type="submit" className={`${button} shrink-0`}>
                Connect
              </button>
            </form>
          </>
        )}
      </ConnectionPanel>

      <ConnectionPanel
        title="Amazon"
        status={amazonLive ? (amazonLogin ? "Needs sign-in" : amazon.state?.lastError ? "Sync problem" : "Connected") : "Not linked"}
        tone={amazonLive ? (amazon.state?.lastError ? "bad" : "ok") : "muted"}
        defaultOpen={!amazonLive || Boolean(amazon.state?.lastError)}
        meta={amazon.state?.lastOkAt ? <LastSyncAgo at={amazon.state.lastOkAt.toISOString()} /> : undefined}
        actions={
          amazonLive ? (
            <>
              <a href="/purchases" className={button}>
                Purchases
              </a>
              <form action={disconnectAmazonNow}>
                <button type="submit" className={danger}>
                  Remove
                </button>
              </form>
            </>
          ) : (
            <a href="/api-keys" className={button}>
              Worker key
            </a>
          )
        }
      >
        {amazonLive ? (
          <>
            <dl>
              <Row label="Recent orders" value={String(amazon.orders.length)} />
              <Row label="Cart" value={String(amazon.cart.length)} />
              {amazon.state?.lastError && <Row label="Status" value={amazon.state.lastError} bad />}
            </dl>
            <p className="text-sm text-muted">
              Amazon has no shopper API for a personal US account. A Chrome session on the worker laptop posts recent orders and the cart
              while that laptop is awake.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Nothing to connect in the browser. Create an Amazon laptop worker key, then run the worker on the second laptop while Chrome
              stays signed in to Amazon.
            </p>
            {amazonLogin && <p className="text-sm text-danger">{LOGIN_REQUIRED}</p>}
          </>
        )}
      </ConnectionPanel>

      <ConnectionPanel
        title="Financial"
        status={!plaidConfigured() ? "Not set up" : items.length ? `${items.length} linked` : "Not linked"}
        tone={!plaidConfigured() || plaidKeys === "rejected" || items.some((it) => it.status !== "ok") ? "bad" : items.length ? "ok" : "muted"}
        defaultOpen={plaidNeedsAttention || items.length === 0}
        actions={
          plaidConfigured() ? (
            <>
              <PlaidLinkButton kind="bank" label="Add bank" className={button} />
              <PlaidLinkButton kind="brokerage" label="Add brokerage" className={button} />
            </>
          ) : undefined
        }
      >
        {!plaidConfigured() ? (
          <p className="text-sm text-danger">Plaid is not set up on this deployment yet.</p>
        ) : (
          <>
            {plaidKeys === "rejected" && (
              <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                Plaid rejected this app's keys. Check that the client ID is right and that the secret matches the environment (production
                secret on the live site).
              </p>
            )}
            {plaidEnv() === "sandbox" && (
              <p className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-muted">
                Test mode: only Plaid's fake sandbox banks can be linked here, so no real data is stored.
              </p>
            )}
            {items.length > 0 && (
              <ul className="-mx-1 divide-y divide-line">
                {items.map((it) => {
                  const accts = accountsByItem.get(it.id) ?? [];
                  return (
                    <li key={it.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusMark ok={it.status === "ok"} label={STATUS[it.status] ?? it.status} />
                        <div className="min-w-0 flex-1">
                          <p className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate font-medium">{it.institutionName}</span>
                            {it.lastSyncedAt ? <LastSyncAgo at={it.lastSyncedAt.toISOString()} /> : <span className="shrink-0 text-sm font-normal text-muted">(not synced yet)</span>}
                          </p>
                          {it.lastError && <p className="text-sm text-danger">{it.lastError}</p>}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {needsInvestmentAccess(it.id) && (
                            <PlaidLinkButton kind={it.kind as "bank" | "brokerage"} itemId={it.id} addInvestments label="Allow investments" className={button} />
                          )}
                          {it.status === "login_required" && (
                            <PlaidLinkButton kind={it.kind as "bank" | "brokerage"} itemId={it.id} label="Sign in" className={button} />
                          )}
                          <form action={syncFinance.bind(null, it.id)}>
                            <button type="submit" className={button}>
                              Sync
                            </button>
                          </form>
                          <form action={unlinkFinance.bind(null, it.id)}>
                            <button type="submit" className={danger}>
                              Remove
                            </button>
                          </form>
                        </div>
                      </div>
                      {accts.length ? (
                        <ul className="ml-7 space-y-1">
                          {accts.map((a) => {
                            const balance = a.current == null ? null : isLiability({ type: a.type ?? "other" }) ? -a.current : a.current;
                            return (
                              <li key={a.id} className="flex items-baseline justify-between gap-4 text-sm">
                                <AccountNickname id={a.id} name={a.name} nickname={a.nickname} kind={accountKind(a.type, a.subtype)} />
                                <span className={`shrink-0 tabular-nums ${balance == null ? "text-muted" : moneyTone(balance)}`}>
                                  {balance == null ? "n/a" : fmtMoney(balance)}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="ml-7 text-sm text-muted">No accounts synced yet.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </ConnectionPanel>
    </div>
    </>
  );
}

function Row({ label, value, bad }: { label: string; value: ReactNode; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`text-right text-sm ${bad ? "text-danger" : ""}`}>{value}</dd>
    </div>
  );
}

async function loadAcctRows() {
  return db()
    .select({
      id: accounts.id,
      itemId: accounts.itemId,
      name: accounts.name,
      nickname: sql<string | null>`"nickname"`,
      type: accounts.type,
      subtype: accounts.subtype,
      current: accounts.currentBalance,
    })
    .from(accounts)
    .orderBy(accounts.name);
}

async function loadHoldingCounts() {
  try {
    return await db()
      .select({ itemId: sql<string>`${events.payload}->>'itemId'`, n: sql<number>`count(*)` })
      .from(events)
      .where(eq(events.key, "finance.holding"))
      .groupBy(sql`${events.payload}->>'itemId'`);
  } catch {
    return [];
  }
}
