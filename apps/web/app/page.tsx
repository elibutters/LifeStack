import { count } from "drizzle-orm";
import { events, syncState } from "@lifestack/db";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { logout } from "./login/actions";

export const dynamic = "force-dynamic";

async function status() {
  try {
    const [[e], [s]] = await Promise.all([
      db().select({ n: count() }).from(events),
      db().select({ n: count() }).from(syncState),
    ]);
    return { ok: true as const, events: e?.n ?? 0, sources: s?.n ?? 0 };
  } catch {
    return { ok: false as const };
  }
}

export default async function Today() {
  await requireSession();
  const s = await status();
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: process.env.APP_TZ || "UTC",
  });

  return (
    <main className="mx-auto max-w-md p-6">
      <p className="text-sm text-neutral-400">{today}</p>
      <h1 className="mt-1 text-3xl font-semibold">Today</h1>
      <dl className="mt-8 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
        <Row label="Database" value={s.ok ? "connected" : "unreachable"} bad={!s.ok} />
        <Row label="Events" value={s.ok ? String(s.events) : "-"} />
        <Row label="Sources" value={s.ok ? String(s.sources) : "-"} />
      </dl>
      <form action={logout} className="mt-8">
        <button type="submit" className="text-sm text-neutral-500 underline">
          Sign out
        </button>
      </form>
    </main>
  );
}

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="text-neutral-400">{label}</dt>
      <dd className={bad ? "text-red-400" : ""}>{value}</dd>
    </div>
  );
}
