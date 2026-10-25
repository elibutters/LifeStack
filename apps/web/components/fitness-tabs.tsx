"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/fitness", label: "Plan" },
  { href: "/fitness/running", label: "Running" },
];

export function FitnessTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Fitness" className="-mx-1 flex gap-1 overflow-x-auto">
      {TABS.map((t) => {
        const active = t.href === "/fitness" ? pathname === "/fitness" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-9 shrink-0 items-center border-b px-3 text-sm transition-colors ${active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
