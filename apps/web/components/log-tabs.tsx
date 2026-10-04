"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/log", label: "Quick log" },
  { href: "/log/history", label: "History" },
];

export function LogTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Log" className="-mx-1 mb-6 flex gap-1 overflow-x-auto pb-1">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-9 shrink-0 items-center rounded-md px-3 text-sm transition-colors ${active ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
