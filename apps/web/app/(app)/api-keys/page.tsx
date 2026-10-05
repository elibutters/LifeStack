import type { Metadata } from "next";
import { headers } from "next/headers";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { CreateTokenForm, RevokeButton } from "@/components/token-manager";
import { requireSession } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { listTokens } from "@/lib/tokens";

export const metadata: Metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { shortcut: "iPhone Shortcut", widget: "Widget or app", agent: "Agent" };
const code = "block overflow-x-auto rounded-md bg-surface px-3 py-2 text-sm whitespace-pre";

export default async function ApiKeys() {
  await requireSession();
  const tokens = await listTokens().catch(() => null);
  if (!tokens) return <p className="text-danger">Couldn't load your keys. Try again shortly.</p>;
  const host = (await headers()).get("host") ?? "your-app.example";
  const origin = process.env.APP_URL || `https://${host}`;
  const active = tokens.filter((t) => !t.revokedAt);
  const revoked = tokens.filter((t) => t.revokedAt);

  return (
    <>
      <PageHeader>
        <h1 className="text-3xl font-semibold tracking-tight">API keys</h1>
      </PageHeader>
      <div className="space-y-6">
      <div className="max-w-3xl space-y-4">
      <Card title="Keys">
        <p className="mb-3 text-sm text-muted">
          A key lets one Shortcut, widget, agent or the Amazon laptop worker talk to the API without your password. Each has its own, so you can cancel one without touching the others. Only a fingerprint is stored, so a lost key cannot be recovered, only replaced.
        </p>
        {active.length > 0 && (
          <ul className="mb-4 divide-y divide-line">
            {active.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate">{t.name}</p>
                  <p className="text-sm text-muted">
                    {KIND[t.kind] ?? t.kind} &middot;{" "}
                    {t.scopes.includes("amazon:write")
                      ? "Amazon snapshots"
                      : t.scopes.includes("finance:read")
                        ? "agent: reads everything"
                        : t.scopes.includes("log:read")
                          ? "add and read today"
                          : "only adds logs"}{" "}
                    &middot; {t.prefix}&hellip; &middot;{" "}
                    {t.lastUsedAt ? `last used ${fmtDateTime(t.lastUsedAt)}` : "never used"}
                  </p>
                </div>
                <RevokeButton id={t.id} name={t.name} />
              </li>
            ))}
          </ul>
        )}
        <CreateTokenForm />
        {revoked.length > 0 && <p className="mt-3 text-xs text-muted">{revoked.length} revoked key{revoked.length === 1 ? "" : "s"} no longer {revoked.length === 1 ? "works" : "work"}.</p>}
      </Card>

      <Card title="Connect an agent (MCP)">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Create a key above with access <strong>Agent: read everything and add logs</strong> and copy it.</li>
          <li>In Claude Code, run the command below with your key in place of <code className="rounded bg-surface px-1.5 py-0.5">ls_...</code>.</li>
        </ol>
        <code className={`${code} mt-3`}>{`claude mcp add --transport http life-stack ${origin}/api/v1/mcp \\\n  --header "Authorization: Bearer ls_..."`}</code>
        <p className="mt-3 text-sm text-muted">
          The same key can <code className="rounded bg-surface px-1.5 py-0.5">GET {origin}/api/v1/overview</code> for a compact today digest (log, calendar, last night, spending) sized for a widget.
        </p>
      </Card>

      <Card title="Set up an iPhone Shortcut">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Create a key above (kind: iPhone Shortcut) and copy it.</li>
          <li>In the Shortcuts app tap <strong>+</strong>, then add the action <strong>Get Contents of URL</strong>.</li>
          <li>Set the URL to <code className="rounded bg-surface px-1.5 py-0.5">{origin}/api/v1/events</code>.</li>
          <li>Tap <strong>Show More</strong>. Set Method to <strong>POST</strong>. Under Headers add <code className="rounded bg-surface px-1.5 py-0.5">Authorization</code> with the value <code className="rounded bg-surface px-1.5 py-0.5">Bearer </code> followed by your key.</li>
          <li>Set Request Body to <strong>JSON</strong> and add the fields from one of the examples below.</li>
          <li>Name the Shortcut, then add it to your Home Screen, or assign it to the Action Button or Back Tap (Settings, Accessibility, Touch).</li>
        </ol>
        <p className="mt-4 mb-1 text-sm text-muted">Mood (value 1 to 5; <em>note</em> is optional):</p>
        <code className={code}>{`{ "type": "mood", "value": 4, "note": "calm" }`}</code>
        <p className="mt-3 mb-1 text-sm text-muted">Caffeine (<em>mg</em> is optional, a typical amount is used if left out):</p>
        <code className={code}>{`{ "type": "caffeine", "drink": "Coffee", "mg": 75 }`}</code>
        <p className="mt-3 mb-1 text-sm text-muted">Supplement (use the same name as on the Quick log page):</p>
        <code className={code}>{`{ "type": "supplement", "name": "Morning stack" }`}</code>
        <p className="mt-4 text-sm text-muted">
          Add <code className="rounded bg-surface px-1.5 py-0.5">"at": "2026-10-04T08:00:00-04:00"</code> to log something that already happened (up to 30 days back). Add an <code className="rounded bg-surface px-1.5 py-0.5">"id"</code> of 8 to 64 letters and numbers if a request might be retried, and it will never be logged twice.
        </p>
      </Card>

      <Card title="Amazon laptop worker">
        <p className="mb-3 text-sm text-muted">
          Create a key above with access set to Amazon laptop worker. The second laptop posts snapshots to this URL. The key
          stays in a gitignored env file on that machine, never in the repo.
        </p>
        <code className={code}>{`${origin}/api/v1/amazon/snapshot`}</code>
      </Card>
      </div>
    </div>
    </>
  );
}
