"use client";

import { useState, type ReactNode } from "react";
import { StatusMark } from "@/components/status-mark";

export function ConnectionPanel({
  title,
  status,
  tone = "muted",
  meta,
  actions,
  defaultOpen = false,
  children,
}: {
  title: string;
  status?: string;
  tone?: "ok" | "warn" | "bad" | "muted";
  meta?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ok = tone === "ok" || tone === "warn";
  return (
    <section className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1 text-left hover:text-fg"
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          >
            <path d="M6 3.5L11 8l-5 4.5" />
          </svg>
          <StatusMark ok={ok} label={status ?? (ok ? "Connected" : "Not linked")} />
          <h2 className="truncate text-sm font-medium">{title}</h2>
          {meta}
        </button>
        {actions && <div className="flex flex-wrap items-center justify-end gap-1.5">{actions}</div>}
      </div>
      {open && <div className="space-y-3 border-t border-line px-4 py-3">{children}</div>}
    </section>
  );
}
