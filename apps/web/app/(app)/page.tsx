import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { Card } from "@/components/card";
import { EventRow } from "@/components/event-row";
import { loadCalendar, systemStatus } from "@/lib/calendar";
import { syncOutlookIfStale } from "@/lib/outlook";
import { requireSession } from "@/lib/auth";
import { addDays, fmtDayLong, hourOf, startOfDay, ymd } from "@/lib/dates";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";
// The post-render calendar refresh runs inside this limit.
export const maxDuration = 60;

function greeting(hour: number) {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default async function Overview() {
  await requireSession();
  after(syncOutlookIfStale);
  const now = new Date();
  const today = ymd(now);
  const tomorrow = startOfDay(addDays(today, 1));
  const [todayRes, soonRes, status] = await Promise.all([
    loadCalendar(startOfDay(today), tomorrow),
    loadCalendar(tomorrow, startOfDay(addDays(today, 8))),
    systemStatus(),
  ]);
  const todayItems = todayRes.items;
  // Things already under way belong to Today; Coming up lists what starts later.
  const soon = soonRes.items.filter((i) => i.start >= tomorrow);
  const notConnected = status.ok && !status.calendarConnected;
  const failed = todayRes.failed || soonRes.failed;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted">{fmtDayLong(today)}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{greeting(hourOf(now))}</h1>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card
          title="Today"
          className="md:col-span-2"
          action={
            <Link href="/calendar" className="text-sm text-accent">
              Calendar
            </Link>
          }
        >
          {todayItems.length > 0 ? (
            <ul className="divide-y divide-line">
              {todayItems.map((i) => (
                <EventRow key={i.id} item={i} day={today} />
              ))}
            </ul>
          ) : failed ? (
            <p className="py-2 text-red-400">Couldn't load events. Try again shortly.</p>
          ) : (
            <p className="py-2 text-muted">
              {notConnected ? (
                <>
                  Your calendar isn't connected yet.{" "}
                  <Link href="/settings" className="text-accent">
                    Connect Outlook
                  </Link>
                </>
              ) : (
                "Nothing scheduled today."
              )}
            </p>
          )}
        </Card>

        <Card title="System">
          <dl className="divide-y divide-line">
            <StatusRow label="Database" value={status.ok ? "Connected" : "Unreachable"} bad={!status.ok} />
            <StatusRow label="Events" value={status.ok ? String(status.events) : "-"} />
            <StatusRow label="Sources" value={status.ok ? String(status.sources) : "-"} />
            <StatusRow label="Calendar" value={status.ok && status.calendarConnected ? "Syncing" : "Not connected"} />
          </dl>
        </Card>

        <Card title="Coming up" className="md:col-span-3">
          {soon.length > 0 ? (
            <ul className="divide-y divide-line">
              {soon.slice(0, 6).map((i) => (
                <EventRow key={i.id} item={i} showDate />
              ))}
            </ul>
          ) : failed ? (
            <p className="py-2 text-red-400">Couldn't load events. Try again shortly.</p>
          ) : (
            <p className="py-2 text-muted">Nothing in the next seven days.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatusRow({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className={bad ? "text-red-400" : ""}>{value}</dd>
    </div>
  );
}
