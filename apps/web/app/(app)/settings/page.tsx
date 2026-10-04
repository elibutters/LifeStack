import type { Metadata } from "next";
import { Card } from "@/components/card";
import { SignOutIcon } from "@/components/icons";
import { PlaidLinkButton } from "@/components/plaid-link";
import { requireSession } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { listItems } from "@/lib/finance";
import { microsoftConfigured } from "@/lib/microsoft";
import { keyStatus, plaidConfigured, plaidEnv } from "@/lib/plaid";
import { getConnection, getSyncState } from "@/lib/outlook";
import { db } from "@/lib/db";
import { accounts } from "@lifestack/db";
import { count } from "drizzle-orm";
import { logout } from "@/app/login/actions";
import { disconnect, syncFinance, syncNow, unlinkFinance } from "./actions";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { ok: "Connected", login_required: "Needs you to sign in again", error: "Sync problem" };

const MESSAGES: Record<string, string> = {
  not_configured: "Microsoft app credentials are not set up on this deployment yet.",
  denied: "Microsoft sign-in was cancelled.",
  state: "That sign-in attempt expired or did not match. Try again.",
  exchange: "Microsoft sign-in could not be completed. Try again.",
};

const button = "flex h-11 items-center rounded-md border border-line px-4 text-sm hover:bg-raised";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const [conn, state, items, perItem] = await Promise.all([
    getConnection().catch(() => null),
    getSyncState().catch(() => null),
    listItems().catch(() => []),
    db()
      .select({ itemId: accounts.itemId, n: count() })
      .from(accounts)
      .groupBy(accounts.itemId)
      .catch(() => []),
  ]);
  const accountCount = new Map(perItem.map((r) => [r.itemId, r.n]));
  const plaidKeys = plaidConfigured() ? await keyStatus() : null;
  // "not configured" is already explained inside the card, so it gets no banner.
  const error = sp.error && sp.error !== "not_configured" ? (MESSAGES[sp.error] ?? "Something went wrong.") : null;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>

      {error && <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-300">{error}</p>}
      {sp.connected && !error && (
        <p className="rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-accent">
          Outlook connected. Your calendar is syncing and will appear in a moment.
        </p>
      )}

      <Card title="Outlook calendar" className="max-w-2xl">
        {conn ? (
          <div className="space-y-4">
            <dl className="divide-y divide-line">
              <Row label="Account" value={conn.account ?? "Connected"} />
              <Row label="Last synced" value={state?.lastOkAt ? fmtDateTime(state.lastOkAt) : "Not yet"} />
              {state?.lastError && <Row label="Status" value={state.lastError} bad />}
            </dl>
            <div className="flex flex-wrap gap-2">
              <form action={syncNow}>
                <button type="submit" className={button}>
                  Sync now
                </button>
              </form>
              <a href="/api/connections/outlook/start" className={button}>
                Reconnect
              </a>
              <form action={disconnect}>
                <button type="submit" className={`${button} text-red-300`}>
                  Disconnect and remove events
                </button>
              </form>
            </div>
            <p className="text-sm text-muted">
              Disconnecting stops syncing and deletes the copied events. To also withdraw Life Stack's access at Microsoft,
              remove it at account.live.com/consent/Manage.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-muted">
              Link a personal Outlook account (outlook.com, hotmail.com or live.com) to show its calendar here. The app only
              reads your calendar; it can never change it.
            </p>
            {microsoftConfigured() ? (
              <a href="/api/connections/outlook/start" className={`${button} w-fit`}>
                Connect Outlook
              </a>
            ) : (
              <p className="text-red-300">{MESSAGES.not_configured}</p>
            )}
          </div>
        )}
      </Card>

      <Card title="Bank and investment accounts" className="max-w-2xl">
        <div className="space-y-4">
          {!plaidConfigured() ? (
            <p className="text-red-300">Plaid is not set up on this deployment yet.</p>
          ) : (
            <>
              {plaidKeys === "rejected" && (
                <p className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">
                  Plaid rejected this app's keys. Check that the client ID is right and that the secret matches the environment
                  (production secret on the live site).
                </p>
              )}
              {plaidKeys === "ok" && plaidEnv() === "production" && <p className="text-sm text-muted">Connected to Plaid with live keys.</p>}
              {plaidEnv() === "sandbox" && (
                <p className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-muted">
                  Test mode: only Plaid's fake sandbox banks can be linked here, so no real data is stored.
                </p>
              )}
              {items.length > 0 && (
                <ul className="divide-y divide-line">
                  {items.map((it) => (
                    <li key={it.id} className="space-y-2 py-3">
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="font-medium">{it.institutionName}</span>
                        <span className={it.status === "ok" ? "text-sm text-muted" : "text-sm text-red-300"}>
                          {STATUS[it.status] ?? it.status}
                        </span>
                      </div>
                      <p className="text-sm text-muted">
                        {it.kind === "brokerage" ? "Brokerage" : "Bank or card"} &middot; {accountCount.get(it.id) ?? 0} account
                        {(accountCount.get(it.id) ?? 0) === 1 ? "" : "s"} &middot;{" "}
                        {it.lastSyncedAt ? `synced ${fmtDateTime(it.lastSyncedAt)}` : "not synced yet"}
                      </p>
                      {it.lastError && <p className="text-sm text-red-300">{it.lastError}</p>}
                      <div className="flex flex-wrap items-start gap-2">
                        {it.status === "login_required" && (
                          <PlaidLinkButton kind={it.kind as "bank" | "brokerage"} itemId={it.id} label="Sign in again" className={button} />
                        )}
                        <form action={syncFinance.bind(null, it.id)}>
                          <button type="submit" className={button}>
                            Sync now
                          </button>
                        </form>
                        <form action={unlinkFinance.bind(null, it.id)}>
                          <button type="submit" className={`${button} text-red-300`}>
                            Remove and delete data
                          </button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <PlaidLinkButton kind="bank" label="Add bank or card" className={button} />
                <PlaidLinkButton kind="brokerage" label="Add brokerage" className={button} />
              </div>
              <p className="text-sm text-muted">
                You sign in inside Plaid's secure window; this app never sees your bank password. Only transactions, balances and
                holdings are read, never account numbers.
              </p>
            </>
          )}
        </div>
      </Card>

      <Card title="Session" className="max-w-2xl">
        <form action={logout}>
          <button type="submit" className={`${button} gap-2`}>
            <SignOutIcon width={18} height={18} />
            Sign out
          </button>
        </form>
      </Card>
    </div>
  );
}

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right ${bad ? "text-red-300" : ""}`}>{value}</dd>
    </div>
  );
}
