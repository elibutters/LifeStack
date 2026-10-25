import type { Metadata } from "next";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { listSettings } from "@/lib/settings";
import { resetSettingAction } from "./actions";

export const metadata: Metadata = { title: "Preferences" };
export const dynamic = "force-dynamic";

const show = (v: unknown) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

export default async function PreferencesPage() {
  await requireSession();
  const items = await listSettings().catch(() => null);
  return (
    <>
      <PageHeader>
        <h1 className="text-3xl font-semibold tracking-tight">Preferences</h1>
      </PageHeader>
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-muted">Things that change how Life Stack behaves without a new version. Ask your assistant to change one (it has get_settings and set_setting), or reset it here. Web changes show on the next page load and the iPhone app picks them up when it opens.</p>
        <Card title="Settings">
          {!items ? (
            <p className="py-2 text-sm text-danger">Couldn&apos;t load preferences. Try again shortly.</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((s) => (
                <li key={s.key} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="font-mono text-sm">{s.key}</p>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${s.custom ? "text-accent" : "text-muted"}`}>{s.custom ? "custom" : "default"}</span>
                      {s.custom && (
                        <form action={resetSettingAction}>
                          <input type="hidden" name="key" value={s.key} />
                          <button type="submit" className="h-7 rounded-md border border-line px-2 text-xs text-muted hover:bg-raised hover:text-fg">Reset</button>
                        </form>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-muted">{s.description}</p>
                  <p className="mt-1 break-words rounded-md bg-surface px-2 py-1 font-mono text-xs">{show(s.value)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
