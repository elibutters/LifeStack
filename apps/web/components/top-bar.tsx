import Link from "next/link";
import { DesktopNav, ProfileLink } from "./nav";

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-4 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-raised text-[11px] font-bold tracking-tight">
            LS
          </span>
          <span className="font-semibold tracking-tight">Life Stack</span>
        </Link>
        <DesktopNav />
        <ProfileLink />
      </div>
    </header>
  );
}
