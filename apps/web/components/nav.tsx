"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { CalendarIcon, FinanceIcon, LogIcon, OverviewIcon, SleepIcon } from "./icons";

type Item = { href: string; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> };

// Adding a tab is one line here. The bottom bar on phones fits about five.
const NAV: Item[] = [
  { href: "/", label: "Overview", Icon: OverviewIcon },
  { href: "/calendar", label: "Calendar", Icon: CalendarIcon },
  { href: "/sleep", label: "Sleep", Icon: SleepIcon },
  { href: "/finance", label: "Finance", Icon: FinanceIcon },
  { href: "/log", label: "Log", Icon: LogIcon },
];

function useActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
}

export function SidebarNav({ expanded }: { expanded: boolean }) {
  const active = useActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
      {NAV.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          title={expanded ? undefined : label}
          aria-current={active(href) ? "page" : undefined}
          className={`flex items-center rounded-md py-2 text-sm transition-colors ${
            expanded ? "gap-2.5 px-2.5" : "justify-center px-0"
          } ${active(href) ? "bg-raised text-fg" : "text-muted hover:bg-raised hover:text-fg"}`}
        >
          <Icon width={18} height={18} />
          {expanded ? label : <span className="sr-only">{label}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function MobileNav() {
  const active = useActive();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {NAV.map(({ href, label, Icon }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
                active(href) ? "text-accent" : "text-muted"
              }`}
            >
              <Icon />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
