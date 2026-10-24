import type { Metadata } from "next";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { kickSync, searchNotes } from "@/lib/notes";

export const metadata: Metadata = { title: "Notes" };
export const dynamic = "force-dynamic";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireSession();
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  kickSync();
  const items = await searchNotes({ q: q || undefined, limit: 50 }).catch(() => null);
  return (
    <>
      <PageHeader>
        <h1 className="text-3xl font-semibold tracking-tight">Notes</h1>
      </PageHeader>
      <div className="max-w-3xl space-y-4">
        <form method="get" className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search your Notion pages" aria-label="Search notes" className="h-9 min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 text-sm outline-none focus:border-accent" />
          <button type="submit" className="h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg">Search</button>
        </form>
        <Card title={q ? `Results for "${q}"` : "Recently edited"}>
          {!items ? (
            <p className="py-2 text-sm text-danger">Couldn&apos;t load notes. Try again shortly.</p>
          ) : items.length === 0 ? (
            <p className="py-2 text-sm text-muted">{q ? "Nothing matched." : "No notes yet. Connect Notion on the Connections page and share some pages with it."}</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((n) => (
                <li key={n.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="min-w-0 truncate font-medium">
                      {n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{n.title}</a> : n.title}
                    </p>
                    <span className="text-xs text-muted tabular-nums">{when(n.editedAt)}</span>
                  </div>
                  {n.snippet && <p className="mt-1 text-sm text-muted">{n.snippet}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
