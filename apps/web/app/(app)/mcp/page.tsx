import type { Metadata } from "next";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { offeredTools } from "@/lib/mcp";
import { loadCalls } from "@/lib/mcp-usage";
import { commonErrors, repeats, sequences, toolStats, unused } from "@/lib/mcp-usage-core";

export const metadata: Metadata = { title: "Claude usage" };
export const dynamic = "force-dynamic";

const DAYS = 30;

export default async function McpUsage() {
  await requireSession();
  const calls = await loadCalls(DAYS).catch(() => null);
  if (!calls) return <p className="text-danger">Couldn't load usage. Try again shortly.</p>;
  const stats = toolStats(calls);
  const errors = commonErrors(calls);
  const again = repeats(calls);
  const pairs = sequences(calls);
  const never = unused(offeredTools(), calls);
  const failed = calls.filter((c) => c.outcome !== "ok").length;

  return (
    <>
      <PageHeader>
        <h1 className="text-3xl font-semibold tracking-tight">Claude usage</h1>
      </PageHeader>
      <div className="max-w-4xl space-y-4">
        <Card title={`Last ${DAYS} days`}>
          <p className="text-sm text-muted">
            {calls.length} tool calls, {failed} failed. Only the tool, the key, the timing, the size of the answer and the names of the arguments are recorded: never the values or the answers.
          </p>
        </Card>
        <Card title="Tools">
          {stats.length === 0 ? <p className="text-sm text-muted">No calls yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted"><tr><th className="py-1 pr-3 font-normal">Tool</th><th className="pr-3 font-normal">Calls</th><th className="pr-3 font-normal">Failed</th><th className="pr-3 font-normal">Avg ms</th><th className="pr-3 font-normal">Slowest 5%</th><th className="pr-3 font-normal">Biggest answer</th><th className="font-normal">Last</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {stats.map((s) => (
                    <tr key={s.tool}><td className="py-1.5 pr-3">{s.tool}</td><td className="pr-3">{s.calls}</td><td className="pr-3">{s.errors ? `${s.errors} (${Math.round(s.errorRate * 100)}%)` : "0"}</td><td className="pr-3">{s.avgMs}</td><td className="pr-3">{s.p95Ms}</td><td className="pr-3">{(s.maxBytes / 1024).toFixed(1)} KB</td><td className="text-muted">{fmtDateTime(s.lastAt)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="What goes wrong">
          {errors.length === 0 ? <p className="text-sm text-muted">No failures.</p> : (
            <ul className="divide-y divide-line text-sm">
              {errors.map((e) => (
                <li key={`${e.tool}${e.outcome}${e.error}`} className="py-2">
                  <p>{e.tool} <span className="text-muted">&middot; {e.count}x &middot; {e.outcome.replace("_", " ")}</span></p>
                  {e.error && <p className="text-muted">{e.error}</p>}
                  <p className="text-muted">arguments sent: {e.argKeys.length ? e.argKeys.join(", ") : "none"}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Called again within five minutes">
            {again.length === 0 ? <p className="text-sm text-muted">None.</p> : <ul className="text-sm">{again.map((r) => <li key={r.tool}>{r.tool} <span className="text-muted">&middot; {r.count}x</span></li>)}</ul>}
          </Card>
          <Card title="Often called back to back">
            {pairs.length === 0 ? <p className="text-sm text-muted">None.</p> : <ul className="text-sm">{pairs.map((p) => <li key={p.from + p.to}>{p.from} then {p.to} <span className="text-muted">&middot; {p.count}x</span></li>)}</ul>}
          </Card>
        </div>
        <Card title="Never called">
          {never.length === 0 ? <p className="text-sm text-muted">Every tool was used.</p> : <p className="text-sm">{never.join(", ")}</p>}
        </Card>
      </div>
    </>
  );
}
