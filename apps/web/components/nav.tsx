"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { CalendarIcon, OverviewIcon } from "./icons";

type Item = { href: string; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> };

// Adding a tab is one line here. The bottom bar on phones fits about five.
const NAV: Item[] = [
  { href: "/", label: "Overview", Icon: OverviewIcon },
  { href: "/calendar", label: "Calendar", Icon: CalendarIcon },
];

function useActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
}

export function DesktopNav() {
  const active = useActive();
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
      {NAV.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={active(href) ? "page" : undefined}
          className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors ${
            active(href) ? "bg-raised text-fg" : "text-muted hover:text-fg"
          }`}
        >
          <Icon width={18} height={18} />
          {label}
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
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
