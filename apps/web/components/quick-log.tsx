"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { addSupplementAction, archiveSupplementAction, logCaffeine, logMood, logSupplement, setSupplementDoseAction, unlogSupplement, undoLog, type LogResult } from "@/app/(app)/log/actions";
import { Card } from "@/components/card";
import { StatusMark } from "@/components/status-mark";
import { CAFFEINE_PRESETS, MOOD_LABELS } from "@/lib/capture-core";

const tap = "min-h-14 rounded-md border px-3 text-base transition-colors disabled:opacity-50";
const MOOD_ON = ["", "border-mood-1 bg-mood-1/25", "border-mood-2 bg-mood-2/25", "border-mood-3 bg-mood-3/30", "border-mood-4 bg-mood-4/25", "border-mood-5 bg-mood-5/25"];
const linkBtn = "min-h-11 px-2 text-sm text-accent";
const drinkKey = (name: string) => name.trim().toLowerCase();

// One tap logs; the confirmation offers Undo for a few seconds, so a mis-tap costs nothing.
export function QuickLog({
  supplements,
  taken,
  caffeine,
  mood: moodNow,
}: {
  supplements: { id: number; name: string; dose: number | null; unit: "mg" | "g" }[];
  taken: string[];
  caffeine: { id: number; drink: string }[];
  mood: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ id: number; label: string; supplement?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [mg, setMg] = useState("");
  const [name, setName] = useState("");
  const [mood, setMood] = useState(moodNow);
  useEffect(() => setMood(moodNow), [moodNow]);
  const [justLogged, setJustLogged] = useState<string[]>([]);
  const [cleared, setCleared] = useState<string[]>([]);
  const [addedDrinks, setAddedDrinks] = useState<{ id: number; drink: string }[]>([]);
  const [removedDrinks, setRemovedDrinks] = useState<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One chain per supplement, so a quick second tap is applied after the first save instead of racing it.
  const chains = useRef(new Map<string, Promise<void>>());
  const generations = useRef(new Map<string, number>());
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const selected = new Set([...taken.map(drinkKey).filter((n) => !cleared.includes(n)), ...justLogged.filter((n) => !cleared.includes(n))]);
  const anySelected = supplements.some((s) => selected.has(drinkKey(s.name)));
  const allSelected = supplements.length > 0 && supplements.every((s) => selected.has(drinkKey(s.name)));
  const drinkLogs = [
    ...caffeine.filter((d) => !removedDrinks.includes(d.id)),
    ...addedDrinks.filter((d) => !removedDrinks.includes(d.id) && !caffeine.some((s) => s.id === d.id)),
  ];
  const drinkCount = (drink: string) => drinkLogs.filter((d) => drinkKey(d.drink) === drinkKey(drink)).length;

  function show(r: LogResult, supplement?: string) {
    if (timer.current) clearTimeout(timer.current);
    if (r.ok) {
      setError(null);
      setToast({ id: r.id, label: r.label, supplement });
      timer.current = setTimeout(() => setToast(null), 6000);
    } else {
      setToast(null);
      setError(r.error);
    }
  }
  const run = (fn: () => Promise<LogResult>) =>
    start(async () => {
      show(await fn());
      router.refresh();
    });
  const addDrink = (drink: string) =>
    start(async () => {
      const r = await logCaffeine(drink);
      if (r.ok) setAddedDrinks((a) => (a.some((x) => x.id === r.id) ? a : [...a, { id: r.id, drink }]));
      show(r);
      router.refresh();
    });
  const removeDrink = (drink: string) => {
    const last = [...drinkLogs].reverse().find((d) => drinkKey(d.drink) === drinkKey(drink));
    if (!last) return;
    start(async () => {
      setRemovedDrinks((ids) => (ids.includes(last.id) ? ids : [...ids, last.id]));
      setToast((t) => (t && t.id === last.id ? null : t));
      await undoLog(last.id);
      router.refresh();
    });
  };
  // The chip changes at once. Saving stays in the background, so the page is not dimmed or locked on a tap.
  function markSupplement(name: string, on: boolean) {
    const key = drinkKey(name);
    if (on) {
      setCleared((c) => c.filter((x) => x !== key));
      setJustLogged((n) => (n.includes(key) ? n : [...n, key]));
    } else {
      setCleared((c) => (c.includes(key) ? c : [...c, key]));
      setJustLogged((n) => n.filter((x) => x !== key));
    }
  }
  function revertSupplement(name: string, attemptedOn: boolean) {
    const key = drinkKey(name);
    if (attemptedOn) {
      setJustLogged((n) => n.filter((x) => x !== key));
      setCleared((c) => (c.includes(key) ? c : [...c, key]));
    } else {
      setCleared((c) => c.filter((x) => x !== key));
      setJustLogged((n) => (n.includes(key) ? n : [...n, key]));
    }
  }
  function scheduleRefresh() {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 80);
  }
  function persistSupplement(name: string, on: boolean): Promise<LogResult | undefined> {
    const key = drinkKey(name);
    const gen = (generations.current.get(key) ?? 0) + 1;
    generations.current.set(key, gen);
    markSupplement(name, on);
    let finish: (r: LogResult | undefined) => void = () => {};
    const result = new Promise<LogResult | undefined>((resolve) => { finish = resolve; });
    const prev = chains.current.get(key) ?? Promise.resolve();
    const job = prev.catch(() => undefined).then(async () => {
      try {
        if (on) {
          const r = await logSupplement(name);
          if (generations.current.get(key) !== gen) return finish(undefined);
          if (!r.ok) {
            revertSupplement(name, true);
            setError(r.error);
            return finish(r);
          }
          setError(null);
          scheduleRefresh();
          return finish(r);
        }
        await unlogSupplement(name);
        if (generations.current.get(key) !== gen) return finish(undefined);
        setError(null);
        scheduleRefresh();
        finish(undefined);
      } catch {
        if (generations.current.get(key) !== gen) return finish(undefined);
        revertSupplement(name, on);
        setError("Couldn't update that supplement.");
        finish({ ok: false, error: "Couldn't update that supplement." });
      }
    });
    chains.current.set(key, job.then(() => undefined, () => undefined));
    return result;
  }
  const logSupp = (s: { name: string }) => {
    const on = !selected.has(drinkKey(s.name));
    void persistSupplement(s.name, on).then((r) => { if (on && r?.ok) show(r, s.name); });
  };
  const selectAll = () => {
    for (const s of supplements) if (!selected.has(drinkKey(s.name))) void persistSupplement(s.name, true);
  };
  const deselectAll = () => {
    for (const s of supplements) if (selected.has(drinkKey(s.name))) void persistSupplement(s.name, false);
  };

  return (
    <div className="space-y-4">
      <Card title="Mood">
        <div className="grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((n) => {
            const on = mood === n;
            return (
              <button
                key={n}
                type="button"
                disabled={pending}
                aria-pressed={on}
                onClick={() => {
                  const previous = mood;
                  setMood(n);
                  start(async () => {
                    const r = await logMood(n);
                    if (!r.ok) setMood(previous);
                    show(r);
                    router.refresh();
                  });
                }}
                className={`${tap} flex flex-col items-center justify-center py-2 ${on ? MOOD_ON[n] : "border-line bg-surface hover:bg-raised active:bg-raised"}`}
              >
                <span className="text-xl font-semibold tabular-nums">{n}</span>
                <span className={`text-xs ${on ? "" : "text-muted"}`}>{MOOD_LABELS[n]}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Caffeine">
        <ul className="space-y-2">
          {CAFFEINE_PRESETS.map((p) => {
            const n = drinkCount(p.drink);
            return (
              <li key={p.drink} className="flex items-center gap-2 rounded-md border border-line bg-surface px-3">
                <div className="min-w-0 flex-1 py-2">
                  <div>{p.drink}</div>
                  <div className="text-xs text-muted">{p.mg} mg</div>
                </div>
                <div className="flex items-center">
                  <button type="button" aria-label={`Remove a ${p.drink}`} disabled={pending || n === 0} onClick={() => removeDrink(p.drink)} className="grid h-11 w-11 place-items-center rounded-md text-lg hover:bg-raised disabled:opacity-40">
                    −
                  </button>
                  <span className="w-6 text-center font-semibold tabular-nums">{n}</span>
                  <button type="button" aria-label={`Add a ${p.drink}`} disabled={pending} onClick={() => addDrink(p.drink)} className="grid h-11 w-11 place-items-center rounded-md text-lg hover:bg-raised disabled:opacity-40">
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(mg);
            if (!Number.isFinite(n) || n < 0 || n > 1000) return setError("Enter an amount between 0 and 1000 mg.");
            setMg("");
            run(() => logCaffeine("Caffeine", n));
          }}
        >
          <input value={mg} onChange={(e) => setMg(e.target.value)} inputMode="numeric" placeholder="Other amount, in mg" aria-label="Caffeine in milligrams" className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base outline-none focus:border-accent" />
          <button type="submit" disabled={pending || !mg} className="h-11 rounded-md border border-line px-4 text-sm hover:bg-raised disabled:opacity-50">Add</button>
        </form>
      </Card>

      <Card
        title="Supplements"
        action={
          <span className="flex items-center">
            {!allSelected && supplements.length > 0 && (
              <button type="button" disabled={editing} onClick={selectAll} className={linkBtn}>
                Select all
              </button>
            )}
            {anySelected && (
              <button type="button" disabled={editing} onClick={deselectAll} className={linkBtn}>
                Deselect all
              </button>
            )}
            {supplements.length ? (
              <button type="button" onClick={() => setEditing((e) => !e)} className={linkBtn}>
                {editing ? "Done" : "Edit"}
              </button>
            ) : null}
          </span>
        }
      >
        {supplements.length > 0 && (
          <ul className={`grid grid-cols-1 gap-2 ${editing ? "" : "sm:grid-cols-2"}`}>
            {supplements.map((s) => {
              const on = selected.has(drinkKey(s.name));
              return (
                <li key={s.id} className="flex min-w-0 gap-2">
                  <button
                    type="button"
                    disabled={editing}
                    aria-pressed={on}
                    onClick={() => logSupp(s)}
                    className={`flex min-h-14 min-w-0 flex-1 items-center gap-2.5 rounded-md border px-3 text-left text-base transition-colors focus-visible:border-accent disabled:opacity-50 ${on ? "border-ok/40 bg-ok/10 active:bg-ok/20" : "border-line bg-raised active:bg-white/10"}`}
                  >
                    <StatusMark ok={on} choice />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {s.dose != null && !editing ? <span className="shrink-0 text-sm tabular-nums text-muted">{s.dose} {s.unit}</span> : null}
                  </button>
                  {editing && (
                    <DoseEditor
                      key={`${s.id}-${s.dose}-${s.unit}`}
                      name={s.name}
                      dose={s.dose}
                      unit={s.unit}
                      onSave={(dose, unit) => start(async () => { if (!(await setSupplementDoseAction(s.id, dose, unit))) setError("Enter a dose between 0 and 100000."); router.refresh(); })}
                    />
                  )}
                  {editing && (
                    <button
                      type="button"
                      aria-label={`Remove ${s.name}`}
                      onClick={() => start(async () => { await archiveSupplementAction(s.id); router.refresh(); })}
                      className="h-14 shrink-0 rounded-md border border-line px-3 text-sm text-red-300 hover:bg-raised"
                    >
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {supplements.length === 0 && <p className="mb-3 text-sm text-muted">Add the things you take, or a whole stack as one button (for example "Morning stack").</p>}
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = name.trim();
            if (!v) return;
            setName("");
            start(async () => {
              if (!(await addSupplementAction(v))) setError("That one is already on the list.");
              router.refresh();
            });
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a supplement or stack" maxLength={60} aria-label="New supplement" className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base outline-none focus:border-accent" />
          <button type="submit" disabled={pending || !name.trim()} className="h-11 rounded-md border border-line px-4 text-sm hover:bg-raised disabled:opacity-50">Add</button>
        </form>
      </Card>

      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-md border border-line bg-raised px-4 py-2 shadow-lg md:bottom-6 md:left-auto md:right-6 md:translate-x-0">
          <span>Logged: {toast.label}</span>
          <button
            type="button"
            onClick={() => {
              const current = toast;
              setToast(null);
              if (current.supplement) {
                void persistSupplement(current.supplement, false);
                return;
              }
              start(async () => {
                await undoLog(current.id);
                setRemovedDrinks((ids) => (ids.includes(current.id) ? ids : [...ids, current.id]));
                router.refresh();
              });
            }}
            className="min-h-11 text-sm text-accent"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

// Dose for one supplement: saves when you leave the field or change the unit.
function DoseEditor({ name, dose, unit, onSave }: { name: string; dose: number | null; unit: "mg" | "g"; onSave: (dose: number | null, unit: "mg" | "g") => void }) {
  const [value, setValue] = useState(dose == null ? "" : String(dose));
  const [u, setU] = useState<"mg" | "g">(unit);
  const commit = (v: string, unitNow: "mg" | "g") => {
    const n = v.trim() === "" ? null : Number(v);
    if (n !== null && !Number.isFinite(n)) return;
    if (n === dose && unitNow === unit) return;
    onSave(n, unitNow);
  };
  return (
    <div className="flex shrink-0 gap-1">
      <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => commit(value, u)} inputMode="decimal" placeholder="Dose" aria-label={`${name} dose`} className="h-14 w-20 rounded-md border border-line bg-surface px-2 text-base outline-none focus:border-accent" />
      <select value={u} onChange={(e) => { const next = e.target.value as "mg" | "g"; setU(next); commit(value, next); }} aria-label={`${name} unit`} className="h-14 rounded-md border border-line bg-surface px-1 text-base">
        <option value="mg">mg</option>
        <option value="g">g</option>
      </select>
    </div>
  );
}
