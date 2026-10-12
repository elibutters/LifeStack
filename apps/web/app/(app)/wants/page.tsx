import type { Metadata } from "next";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { listWants } from "@/lib/wants";
import { fmtCents, summarize, type Want } from "@/lib/wants-core";
import { addWantAction, removeWant, setWantStatus } from "./actions";

export const metadata: Metadata = { title: "Wants" };
export const dynamic = "force-dynamic";

const input = "h-9 w-full min-w-0 rounded-md border border-line bg-bg px-2.5 text-sm outline-none focus:border-accent";
const small = "h-7 rounded-md border border-line px-2 text-xs text-muted hover:bg-raised hover:text-fg";

function Row({ w }: { w: Want }) {
  const done = w.status !== "want";
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5">
      <div className="min-w-0">
        <p className={`truncate ${done ? "text-muted line-through" : ""}`}>
          {w.url ? (
            <a href={w.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {w.title}
            </a>
          ) : (
            w.title
          )}
        </p>
        {w.note && <p className="mt-0.5 text-xs text-muted">{w.note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {w.priceCents != null && <span className="mr-1 tabular-nums">{fmtCents(w.priceCents)}</span>}
        {(done ? [["want", "Reopen"]] : [["bought", "Bought"], ["dropped", "Drop"]]).map(([status, label]) => (
          <form key={status} action={setWantStatus}>
            <input type="hidden" name="id" value={w.id} />
            <input type="hidden" name="status" value={status} />
            <button type="submit" className={small}>{label}</button>
          </form>
        ))}
        <form action={removeWant}>
          <input type="hidden" name="id" value={w.id} />
          <button type="submit" className={small} aria-label={`Delete ${w.title}`}>Delete</button>
        </form>
      </div>
    </li>
  );
}

export default async function WantsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const items = await listWants().catch(() => [] as Want[]);
  const s = summarize(items);
  const open = items.filter((w) => w.status === "want");
  const done = items.filter((w) => w.status !== "want");

  return (
    <>
      <PageHeader>
        <h1 className="text-3xl font-semibold tracking-tight">Wants</h1>
      </PageHeader>
      <div className="max-w-3xl space-y-4">
        {sp.error === "invalid" && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-danger">That did not look right. A title is required; a link must start with http.</p>
        )}
        <Card title="Add">
          <form action={addWantAction} className="grid grid-cols-2 gap-2">
            <input name="title" required maxLength={120} placeholder="What do you want?" aria-label="Title" className={`${input} col-span-2`} />
            <input name="price" inputMode="decimal" placeholder="Price (optional)" aria-label="Price" className={input} />
            <input name="url" type="url" placeholder="Link (optional)" aria-label="Link" className={input} />
            <input name="note" maxLength={500} placeholder="Note (optional)" aria-label="Note" className={`${input} col-span-2`} />
            <button type="submit" className="col-span-2 h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg">Add to wants</button>
          </form>
        </Card>
        <Card
          title="Thinking about"
          action={
            <span className="text-sm text-muted tabular-nums">
              {s.open} item{s.open === 1 ? "" : "s"}
              {s.openTotalCents > 0 ? ` · ${fmtCents(s.openTotalCents)}${s.unpriced ? " + unpriced" : ""}` : ""}
            </span>
          }
        >
          {open.length ? <ul className="divide-y divide-line">{open.map((w) => <Row key={w.id} w={w} />)}</ul> : <p className="py-4 text-sm text-muted">Nothing yet. Add something you have been thinking about buying.</p>}
        </Card>
        {done.length > 0 && (
          <Card title="Bought or dropped">
            <ul className="divide-y divide-line">{done.map((w) => <Row key={w.id} w={w} />)}</ul>
          </Card>
        )}
      </div>
    </>
  );
}
