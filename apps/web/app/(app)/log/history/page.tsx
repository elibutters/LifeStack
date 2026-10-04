import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { loadFeed } from "@/lib/capture";
import { describeEntry } from "@/lib/capture-core";
import { fmtDateTime } from "@/lib/dates";
import { deleteEntry } from "../actions";

export const metadata: Metadata = { title: "Log history" };
export const dynamic = "force-dynamic";

const VIA: Record<string, string> = { manual: "Quick log", shortcut: "Shortcut", widget: "Widget", agent: "Agent" };

export default async function History() {
  await requireSession();
  const feed = await loadFeed(100).catch(() => null);
  if (!feed) return <p className="text-red-300">Couldn't load your log. Try again shortly.</p>;
  if (!feed.length) return <p className="py-6 text-muted">Nothing logged yet. Entries show up here the moment you add them.</p>;
  return (
    <div>
      <p className="mb-3 text-sm text-muted">The latest 100 entries, newest first. Every entry shows where it came from, and can be deleted.</p>
      <ul className="divide-y divide-line rounded-md border border-line bg-surface px-4">
        {feed.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate">{describeEntry(e)}</p>
              <p className="text-sm text-muted">
                {fmtDateTime(e.ts)} &middot; {VIA[e.source] ?? e.source}
              </p>
            </div>
            <form action={deleteEntry.bind(null, e.id)}>
              <button type="submit" aria-label={`Delete ${describeEntry(e)}`} className="h-9 rounded-md border border-line px-3 text-sm text-red-300 hover:bg-raised">Delete</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
