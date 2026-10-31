"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { CalendarIcon, FinanceIcon, LogIcon, OverviewIcon, SleepIcon, GoalsIcon, MapIcon, NotesIcon, PreferencesIcon, TodoIcon, WantsIcon, WorkoutsIcon } from "./icons";

type Item = { href: string; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>>; tint: string; desktopOnly?: boolean };

// Adding a tab is one line here. The bottom bar on phones fits about seven at this width.
// Tints stay dusty so the icon is recognizable and the label stays the quiet grey.
const NAV: Item[] = [
  { href: "/", label: "Overview", Icon: OverviewIcon, tint: "text-[#8eb4e0]" },
  { href: "/calendar", label: "Calendar", Icon: CalendarIcon, tint: "text-[#c4a574]" },
  { href: "/sleep", label: "Sleep", Icon: SleepIcon, tint: "text-[#8a9ec8]" },
  { href: "/fitness", label: "Fitness", Icon: WorkoutsIcon, tint: "text-[#6eae90]" },
  { href: "/finance", label: "Finance", Icon: FinanceIcon, tint: "text-[#7fafc4]" },
  { href: "/log", label: "Log", Icon: LogIcon, tint: "text-[#c4a08a]" },
  { href: "/wants", label: "Wants", Icon: WantsIcon, tint: "text-[#d4a0a8]" },
  { href: "/goals", label: "Goals", Icon: GoalsIcon, tint: "text-[#b7a4d4]", desktopOnly: true },
  { href: "/todos", label: "To do", Icon: TodoIcon, tint: "text-[#9fb88a]", desktopOnly: true },
  { href: "/map", label: "Map", Icon: MapIcon, tint: "text-[#7aabbe]", desktopOnly: true }, // the phone bar is full
  { href: "/notes", label: "Notes", Icon: NotesIcon, tint: "text-[#a3a8c4]", desktopOnly: true },
  { href: "/preferences", label: "Preferences", Icon: PreferencesIcon, tint: "text-[#a39e96]", desktopOnly: true },
];

function useActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
}

export function SidebarNav({ expanded }: { expanded: boolean }) {
  const active = useActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, Icon, tint }) => (
        <Link
          key={href}
          href={href}
          title={expanded ? undefined : label}
          aria-current={active(href) ? "page" : undefined}
          className={`flex items-center border-l-2 py-2 text-sm transition-colors ${
            expanded ? "gap-2.5 pr-2 pl-2" : "justify-center"
          } ${active(href) ? "border-accent text-fg" : "border-transparent text-muted hover:bg-raised hover:text-fg"}`}
        >
          <Icon width={18} height={18} className={tint} />
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:hidden"
    >
      <ul className="flex">
        {NAV.filter((n) => !n.desktopOnly).map(({ href, label, Icon, tint }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 border-t-2 text-[11px] ${
                active(href) ? "border-accent text-fg" : "border-transparent text-muted"
              }`}
            >
              <Icon className={tint} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
