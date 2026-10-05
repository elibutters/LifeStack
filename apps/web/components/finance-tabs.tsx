"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/finance", label: "Overview" },
  { href: "/finance/flow", label: "Flow" },
  { href: "/finance/transactions", label: "Transactions" },
  { href: "/finance/recurring", label: "Recurring" },
  { href: "/finance/investments", label: "Investments" },
];

export function FinanceTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Finance" className="-mx-1 flex gap-1 overflow-x-auto">
      {TABS.map((t) => {
        const active = t.href === "/finance" ? pathname === "/finance" : pathname.startsWith(t.href);
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
