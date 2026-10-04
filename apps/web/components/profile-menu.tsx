"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { logout } from "@/app/login/actions";
import { ChevronUpIcon, KeyIcon, LinkIcon, ShieldIcon, SignOutIcon, UserIcon } from "./icons";

const ITEMS = [
  { href: "/profile", label: "Profile", Icon: UserIcon },
  { href: "/connections", label: "Connections", Icon: LinkIcon },
  { href: "/api-keys", label: "API keys", Icon: KeyIcon },
  { href: "/security", label: "Security", Icon: ShieldIcon },
] as const;

export function onAccountPath(pathname: string) {
  return pathname.startsWith("/profile") || pathname.startsWith("/connections") || pathname.startsWith("/api-keys") || pathname.startsWith("/security") || pathname.startsWith("/settings");
}

export function ProfileMenu({
  placement,
  expanded = true,
}: {
  placement: "sidebar" | "header";
  expanded?: boolean;
}) {
  const pathname = usePathname();
  const keepOpen = onAccountPath(pathname);
  const [open, setOpen] = useState(keepOpen);
  const showing = keepOpen || open;
  const compact = placement === "sidebar" && !expanded;
  const inFlow = placement === "sidebar" && (keepOpen || compact);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!keepOpen) setOpen(false);
  }, [keepOpen]);

  useEffect(() => {
    if (!showing || keepOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [showing, keepOpen]);

  const item = (href?: string) => {
    const active = href ? pathname.startsWith(href) : false;
    if (compact) {
      return `grid h-8 w-full place-items-center rounded-md transition-colors ${
        active ? "bg-raised text-fg" : "text-muted hover:bg-raised hover:text-fg"
      }`;
    }
    return `flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
      active ? "bg-raised text-fg" : "text-muted hover:bg-raised hover:text-fg"
    }`;
  };

  const menuClass = compact
    ? "mb-1 flex flex-col gap-0.5 rounded-md border border-line bg-surface p-1"
    : placement === "header"
      ? "absolute top-full right-0 z-50 mt-1 min-w-44 rounded-md border border-line bg-surface p-1"
      : keepOpen
        ? "flex flex-col gap-0.5 pb-1"
        : "absolute bottom-full left-0 right-0 z-50 mb-1 rounded-md border border-line bg-surface p-1";

  const menu = showing && (
    <MenuList pathname={pathname} item={item} className={menuClass} id={menuId} compact={compact} />
  );

  return (
    <div ref={root} className={`relative ${placement === "sidebar" ? "w-full" : ""}`}>
      {inFlow && menu}
      <button
        type="button"
        aria-expanded={showing}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => {
          if (keepOpen) return;
          setOpen((v) => !v);
        }}
        className={
          placement === "sidebar"
            ? `flex w-full items-center rounded-md py-2 text-sm transition-colors ${
                expanded ? "gap-2.5 px-2.5" : "justify-center px-0"
              } ${keepOpen || open ? "bg-raised text-fg" : "text-muted hover:bg-raised hover:text-fg"}`
            : `grid h-9 w-9 place-items-center rounded-md border border-line transition-colors ${
                keepOpen || open ? "bg-raised text-fg" : "text-muted hover:bg-raised hover:text-fg"
              }`
        }
      >
        {placement === "sidebar" ? (
          <>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-surface">
              <UserIcon width={16} height={16} />
            </span>
            {expanded && (
              <>
                <span className="min-w-0 flex-1 truncate text-left font-medium text-fg">Account</span>
                <ChevronUpIcon width={16} height={16} className={showing ? "" : "rotate-180"} />
              </>
            )}
          </>
        ) : (
          <UserIcon width={18} height={18} />
        )}
      </button>
      {!inFlow && menu}
    </div>
  );
}

function MenuList({
  pathname,
  item,
  className,
  id,
  compact,
}: {
  pathname: string;
  item: (href?: string) => string;
  className: string;
  id: string;
  compact: boolean;
}) {
  return (
    <div id={id} role="menu" className={className}>
      {ITEMS.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          role="menuitem"
          title={compact ? label : undefined}
          aria-label={compact ? label : undefined}
          aria-current={pathname.startsWith(href) ? "page" : undefined}
          className={item(href)}
        >
          <Icon width={16} height={16} />
          {compact ? <span className="sr-only">{label}</span> : label}
        </Link>
      ))}
      <form action={logout}>
        <button
          type="submit"
          role="menuitem"
          title={compact ? "Sign out" : undefined}
          aria-label={compact ? "Sign out" : undefined}
          className={
            compact
              ? "grid h-8 w-full place-items-center rounded-md text-red-300 hover:bg-raised"
              : "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-red-300 hover:bg-raised"
          }
        >
          <SignOutIcon width={16} height={16} />
          {compact ? <span className="sr-only">Sign out</span> : "Sign out"}
        </button>
      </form>
    </div>
  );
}
