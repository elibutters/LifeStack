import type { Metadata } from "next";
import { Card } from "@/components/card";
import { requireSession } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { microsoftConfigured } from "@/lib/microsoft";
import { getConnection, getSyncState } from "@/lib/outlook";
import { disconnect, syncNow } from "./actions";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  not_configured: "Microsoft app credentials are not set up on this deployment yet.",
  denied: "Microsoft sign-in was cancelled.",
  state: "That sign-in attempt expired or did not match. Try again.",
  exchange: "Microsoft sign-in could not be completed. Try again.",
};

const button = "flex h-11 items-center rounded-lg border border-line px-4 text-sm hover:bg-raised";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const [conn, state] = await Promise.all([
    getConnection().catch(() => null),
    getSyncState().catch(() => null),
  ]);
  // "not configured" is already explained inside the card, so it gets no banner.
  const error = sp.error && sp.error !== "not_configured" ? (MESSAGES[sp.error] ?? "Something went wrong.") : null;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>

      {error && <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-300">{error}</p>}
      {sp.connected && !error && (
        <p className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-accent">
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
