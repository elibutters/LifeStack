"use client";

import { useState } from "react";
import { type Contact, type ContactKind } from "@/lib/profile-core";

const input = "h-9 w-full min-w-0 rounded-md border border-line bg-bg px-2.5 text-sm outline-none focus:border-accent";
const KINDS: { value: ContactKind; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "username", label: "Username" },
];

type Row = { id: string; kind: ContactKind; value: string; description: string };

const blank = (): Row => ({ id: crypto.randomUUID(), kind: "email", value: "", description: "" });

export function ContactList({ items }: { items: Contact[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    items.length
      ? items.map((item) => ({ id: crypto.randomUUID(), kind: item.kind, value: item.value, description: item.description ?? "" }))
      : [blank()],
  );
  const set = (id: string, patch: Partial<Row>) => setRows((list) => list.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <div className="mb-3 space-y-2">
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)_3.5rem] gap-2 text-xs text-muted">
        <span>Kind</span>
        <span>Value</span>
        <span>Description</span>
        <span />
      </div>
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)_3.5rem] items-center gap-2">
          <select name="contactKind" aria-label="Kind" value={row.kind} onChange={(e) => set(row.id, { kind: e.target.value as ContactKind })} className={input}>
            {KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
          <input
            name="contactValue"
            aria-label="Value"
            value={row.value}
            maxLength={200}
            placeholder="Email, number, or username"
            onChange={(e) => set(row.id, { value: e.target.value })}
            className={input}
          />
          <input
            name="contactDescription"
            aria-label="Description"
            value={row.description}
            maxLength={120}
            placeholder="What this is"
            onChange={(e) => set(row.id, { description: e.target.value })}
            className={input}
          />
          <button
            type="button"
            onClick={() => setRows((list) => (list.length === 1 ? [blank()] : list.filter((r) => r.id !== row.id)))}
            className="h-9 text-xs text-muted hover:text-danger"
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setRows((list) => (list.length >= 40 ? list : [...list, blank()]))} className="text-sm text-accent">
        Add
      </button>
    </div>
  );
}
