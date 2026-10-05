import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { Card } from "@/components/card";
import { EventRow } from "@/components/event-row";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { itemsOnDay, loadCalendar, systemStatus } from "@/lib/calendar";
import { syncOutlookIfStale } from "@/lib/outlook";
import { requireSession } from "@/lib/auth";
import {
  addDays,
  fmtDayLong,
  fmtMonth,
  isValidDay,
  isValidMonth,
  monthGrid,
  shiftMonth,
  startOfDay,
  ymd,
} from "@/lib/dates";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";
// The post-render calendar refresh runs inside this limit.
export const maxDuration = 60;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const href = (month: string, day?: string) => `/calendar?m=${month}${day ? `&d=${day}` : ""}`;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string; d?: string }> }) {
  await requireSession();
  after(syncOutlookIfStale);
  const sp = await searchParams;
  const today = ymd(new Date());
  const month = isValidMonth(sp.m) ? sp.m : today.slice(0, 7);
  const cells = monthGrid(month);
  const [{ items, failed }, status] = await Promise.all([
    loadCalendar(startOfDay(cells[0]!), startOfDay(addDays(cells.at(-1)!, 1))),
    systemStatus(),
  ]);
  const selected = isValidDay(sp.d) && cells.includes(sp.d) ? sp.d : today.startsWith(month) ? today : `${month}-01`;
  const dayItems = itemsOnDay(items, selected);
  const notConnected = status.ok && !status.calendarConnected;

  return (
    <>
      <PageHeader>
        <div className="flex items-center gap-2">
          <h1 className="mr-auto text-3xl font-semibold tracking-tight">{fmtMonth(month)}</h1>
          <Link
            href={href(today.slice(0, 7), today)}
            className="flex h-11 items-center rounded-md border border-line px-3 text-sm hover:bg-raised"
          >
            Today
          </Link>
          <div className="flex">
            <Link
              href={href(shiftMonth(month, -1))}
              aria-label="Previous month"
              className="grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-raised hover:text-fg"
            >
              <ChevronLeftIcon />
            </Link>
            <Link
              href={href(shiftMonth(month, 1))}
              aria-label="Next month"
              className="grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-raised hover:text-fg"
            >
              <ChevronRightIcon />
            </Link>
          </div>
        </div>
      </PageHeader>
      <div className="space-y-4">

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <div className="grid grid-cols-7 border-b border-line">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-2 text-center text-xs text-muted">
                <span className="md:hidden">{w[0]}</span>
                <span className="hidden md:inline">{w}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              const list = itemsOnDay(items, day);
              const inMonth = day.startsWith(month);
              const isToday = day === today;
              const isSelected = day === selected;
              return (
                <Link
                  key={day}
                  // Days from the neighbouring month are selectable but never change the month being viewed.
                  href={href(month, day)}
                  aria-label={`${fmtDayLong(day)}${list.length ? `, ${list.length} ${list.length === 1 ? "event" : "events"}` : ""}${isSelected ? ", selected" : ""}`}
                  aria-current={isToday ? "date" : undefined}
                  className={`flex min-h-14 flex-col gap-1 border-line p-1.5 md:min-h-28 md:p-2 ${
                    idx % 7 !== 6 ? "border-r" : ""
                  } ${idx < cells.length - 7 ? "border-b" : ""} ${isSelected ? "bg-raised" : "hover:bg-raised/60"}`}
                >
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-sm text-sm tabular-nums ${
                      isToday ? "bg-accent font-semibold text-bg" : inMonth ? "" : "text-muted/70"
                    }`}
                  >
                    {Number(day.slice(8))}
                  </span>
                  <span className="hidden flex-col gap-1 md:flex">
                    {list.slice(0, 3).map((i) => (
                      <span
                        key={i.id}
                        className={`truncate rounded-sm px-1.5 py-0.5 text-xs ${
                          i.kind === "holiday" ? "bg-holiday/15 text-holiday" : "bg-accent/15 text-accent"
                        }`}
                      >
                        {i.title}
                      </span>
                    ))}
                    {list.length > 3 && <span className="px-1.5 text-xs text-muted">+{list.length - 3} more</span>}
                  </span>
                  <span className="flex gap-0.5 md:hidden">
                    {list.slice(0, 3).map((i) => (
                      <span key={i.id} className={`h-1.5 w-1.5 rounded-full ${i.kind === "holiday" ? "bg-holiday" : "bg-accent"}`} />
                    ))}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <Card title={fmtDayLong(selected)} className="lg:sticky lg:top-6 lg:self-start">
          {dayItems.length > 0 ? (
            <ul className="w-max min-w-full divide-y divide-line">
              {dayItems.map((i) => (
                <EventRow key={i.id} item={i} day={selected} />
              ))}
            </ul>
          ) : failed ? (
            <p className="py-2 text-danger">Couldn't load events. Try again shortly.</p>
          ) : (
            <p className="py-2 text-muted">
              {notConnected ? (
                <>
                  Your calendar isn't connected yet.{" "}
                  <Link href="/connections" className="text-accent">
                    Connect Outlook
                  </Link>
                </>
              ) : (
                "Nothing scheduled."
              )}
            </p>
          )}
        </Card>
      </div>
    </div>
    </>
  );
}
