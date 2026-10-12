import type { Metadata } from "next";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { listWants } from "@/lib/wants";
import { fmtCents, summarize, type Want, type WantOption } from "@/lib/wants-core";
import { addOptionAction, addWantAction, removeOption, removeWant, setOptionPrice, setOptionStatus, setWantStatus } from "./actions";

export const metadata: Metadata = { title: "Wants" };
export const dynamic = "force-dynamic";

const input = "h-9 w-full min-w-0 rounded-md border border-line bg-bg px-2.5 text-sm outline-none focus:border-accent";
const small = "h-7 rounded-md border border-line px-2 text-xs text-muted hover:bg-raised hover:text-fg";

function Hidden({ name, value }: { name: string; value: string | number }) {
  return <input type="hidden" name={name} value={value} />;
}

function Btn({ action, fields, label, aria }: { action: (f: FormData) => Promise<void>; fields: Record<string, string | number>; label: string; aria?: string }) {
  return (
    <form action={action}>
      {Object.entries(fields).map(([k, v]) => <Hidden key={k} name={k} value={v} />)}
      <button type="submit" className={small} aria-label={aria}>{label}</button>
    </form>
  );
}

function Option({ o, live, solo }: { o: WantOption; live: boolean; solo: boolean }) {
  const out = o.status === "rejected";
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2">
      <div className="min-w-0">
        <p className={`truncate ${out ? "text-muted line-through" : ""}`}>
          {o.url ? <a href={o.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{o.title}</a> : o.title}
          {o.status === "chosen" && <span className="ml-2 text-xs text-accent">chosen</span>}
          {o.atTarget && !out && <span className="ml-2 rounded-sm bg-ok/20 px-1.5 py-0.5 text-xs text-ok">at target</span>}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {o.targetCents != null ? `target ${fmtCents(o.targetCents)}` : "no target"}
          {o.priceCheckedAt ? ` · seen ${o.priceCheckedAt.slice(0, 10)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {live && !out ? (
          <form action={setOptionPrice} className="flex items-center gap-1">
            <Hidden name="id" value={o.id} />
            <input name="price" inputMode="decimal" defaultValue={o.priceCents != null ? String(o.priceCents / 100) : ""} placeholder="price" aria-label={`Price of ${o.title}`} className="h-7 w-20 rounded-md border border-line bg-bg px-2 text-right text-sm tabular-nums outline-none focus:border-accent" />
            <button type="submit" className={small}>Set</button>
          </form>
        ) : (
          o.priceCents != null && <span className="tabular-nums">{fmtCents(o.priceCents)}</span>
        )}
        {live && o.status === "considering" && <Btn action={setOptionStatus} fields={{ id: o.id, status: "chosen" }} label={solo ? "Bought" : "Pick"} />}
        {live && !solo && o.status === "considering" && <Btn action={setOptionStatus} fields={{ id: o.id, status: "rejected" }} label="Pass" />}
        {live && out && <Btn action={setOptionStatus} fields={{ id: o.id, status: "considering" }} label="Restore" />}
        {live && <Btn action={removeOption} fields={{ id: o.id }} label="Delete" aria={`Delete ${o.title}`} />}
      </div>
    </li>
  );
}

function WantCard({ w }: { w: Want }) {
  const live = w.status === "want";
  const solo = w.options.length <= 1;
  const sub = [w.budgetCents != null ? `budget ${fmtCents(w.budgetCents)}` : null, w.bestPriceCents != null && live && !solo ? `best ${fmtCents(w.bestPriceCents)}` : null].filter(Boolean).join(" · ");
  return (
    <Card
      title={w.title}
      action={
        <div className="flex items-center gap-1.5">
          {sub && <span className="mr-1 text-sm text-muted tabular-nums">{sub}</span>}
          {live ? (
            <>
              <Btn action={setWantStatus} fields={{ id: w.id, status: "bought" }} label="Bought" />
              <Btn action={setWantStatus} fields={{ id: w.id, status: "dropped" }} label="Drop" />
            </>
          ) : (
            <>
              <span className="mr-1 text-xs text-muted">{w.status}</span>
              <Btn action={setWantStatus} fields={{ id: w.id, status: "want" }} label="Reopen" />
            </>
          )}
          <Btn action={removeWant} fields={{ id: w.id }} label="Delete" aria={`Delete ${w.title}`} />
        </div>
      }
    >
      {w.note && <p className="mb-1 text-sm text-muted">{w.note}</p>}
      {w.options.length > 0 && <ul className="divide-y divide-line">{w.options.map((o) => <Option key={o.id} o={o} live={live} solo={solo} />)}</ul>}
      {live && (
        <form action={addOptionAction} className="mt-2 grid grid-cols-6 gap-2">
          <Hidden name="wantId" value={w.id} />
          <input name="title" required maxLength={120} placeholder={w.options.length ? "Add another option" : "Add an option"} aria-label="Option" className={`${input} col-span-6 sm:col-span-3`} />
          <input name="price" inputMode="decimal" placeholder="Price" aria-label="Option price" className={`${input} col-span-2 sm:col-span-1`} />
          <input name="target" inputMode="decimal" placeholder="Target" aria-label="Target price" className={`${input} col-span-2 sm:col-span-1`} />
          <button type="submit" className="col-span-2 h-9 rounded-md border border-line text-sm hover:bg-raised sm:col-span-1">Add</button>
          <input name="url" type="url" placeholder="Link (optional)" aria-label="Option link" className={`${input} col-span-6`} />
        </form>
      )}
    </Card>
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
        <p className="mt-1 text-sm text-muted tabular-nums">
          {s.open} on the lookout{s.deals ? ` · ${s.deals} at target` : ""}
        </p>
      </PageHeader>
      <div className="max-w-3xl space-y-4">
        {sp.error === "invalid" && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-danger">That did not look right. A title is required, prices are numbers, and a link must start with http.</p>
        )}
        <Card title="Add a want">
          <p className="mb-2 text-sm text-muted">One thing, or a kind of thing like &quot;a jacket&quot; to hold several options (you will only get one). Price, target and link are optional.</p>
          <form action={addWantAction} className="grid grid-cols-2 gap-2">
            <input name="title" required maxLength={120} placeholder="What do you want?" aria-label="Title" className={`${input} col-span-2`} />
            <input name="price" inputMode="decimal" placeholder="Price seen" aria-label="Price" className={input} />
            <input name="target" inputMode="decimal" placeholder="Buy at or under" aria-label="Target price" className={input} />
            <input name="url" type="url" placeholder="Link" aria-label="Link" className={input} />
            <input name="budget" inputMode="decimal" placeholder="Budget for the whole want" aria-label="Budget" className={input} />
            <input name="note" maxLength={500} placeholder="Note (size, colour, what to look for)" aria-label="Note" className={`${input} col-span-2`} />
            <button type="submit" className="col-span-2 h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg">Add to wants</button>
          </form>
        </Card>
        {open.length ? open.map((w) => <WantCard key={w.id} w={w} />) : <p className="py-2 text-sm text-muted">Nothing yet.</p>}
        {done.length > 0 && (
          <>
            <h2 className="pt-2 text-lg font-semibold tracking-tight">Bought or dropped</h2>
            {done.map((w) => <WantCard key={w.id} w={w} />)}
          </>
        )}
      </div>
    </>
  );
}
