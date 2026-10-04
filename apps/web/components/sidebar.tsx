"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { LogoMark } from "./logo";
import { SidebarNav } from "./nav";
import { ProfileMenu } from "./profile-menu";

const OPEN_KEY = "ls-sidebar-pinned";

export function Sidebar() {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(window.localStorage.getItem(OPEN_KEY) === "1");
  }, []);

  const toggle = useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const width = expanded ? "w-56" : "w-14";

  return (
    <aside className={`sticky top-0 hidden h-dvh shrink-0 md:block ${width}`}>
      <div
        className={`flex h-full ${width} flex-col border-r border-line bg-bg pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-2 transition-[width] duration-150`}
      >
        <div className={`mb-4 flex ${expanded ? "items-center gap-1 px-1" : "flex-col items-center"}`}>
          <Link href="/" className={`flex min-w-0 items-center ${expanded ? "h-11 flex-1" : "h-11 w-10 justify-center"}`}>
            <span className="grid h-7 w-7 shrink-0 place-items-center">
              <LogoMark size={26} />
            </span>
            {expanded ? (
              <span className="truncate pl-2.5 font-semibold tracking-tight">Life Stack</span>
            ) : (
              <span className="sr-only">Life Stack</span>
            )}
          </Link>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            title={expanded ? "Collapse" : "Expand"}
            onClick={toggle}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-fg"
          >
            {expanded ? <ChevronLeftIcon width={16} height={16} /> : <ChevronRightIcon width={16} height={16} />}
          </button>
        </div>
        <SidebarNav expanded={expanded} />
        <div className="mt-auto px-1">
          <ProfileMenu placement="sidebar" expanded={expanded} />
        </div>
      </div>
    </aside>
  );
}
