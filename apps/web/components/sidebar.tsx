"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PinIcon } from "./icons";
import { SidebarNav } from "./nav";
import { ProfileMenu } from "./profile-menu";

const PIN_KEY = "ls-sidebar-pinned";

export function Sidebar() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  useEffect(() => {
    setPinned(window.localStorage.getItem(PIN_KEY) === "1");
  }, []);

  const togglePin = useCallback(() => {
    setPinned((current) => {
      const next = !current;
      window.localStorage.setItem(PIN_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  return (
    <aside
      className={`sticky top-0 hidden h-dvh shrink-0 md:block ${pinned ? "w-56" : "w-14"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`flex h-full flex-col border-r border-line bg-bg pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-2 transition-[width] duration-150 ${
          expanded ? "w-56" : "w-14"
        } ${!pinned && expanded ? "absolute inset-y-0 left-0 z-40" : ""}`}
      >
        <div className={`mb-4 flex items-center ${expanded ? "gap-1 px-1" : "justify-center"}`}>
          <Link href="/" className={`flex min-w-0 items-center gap-2.5 py-2 ${expanded ? "flex-1 px-2" : "px-0"}`}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-raised text-[11px] font-bold tracking-tight">
              LS
            </span>
            {expanded && <span className="truncate font-semibold tracking-tight">Life Stack</span>}
          </Link>
          {expanded && (
            <button
              type="button"
              aria-pressed={pinned}
              aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
              title={pinned ? "Unpin" : "Pin open"}
              onClick={togglePin}
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors ${
                pinned ? "bg-raised text-fg" : "text-muted hover:bg-raised hover:text-fg"
              }`}
            >
              <PinIcon width={16} height={16} />
            </button>
          )}
        </div>
        <SidebarNav expanded={expanded} />
        <div className="mt-auto px-1">
          <ProfileMenu placement="sidebar" expanded={expanded} />
        </div>
      </div>
    </aside>
  );
}
