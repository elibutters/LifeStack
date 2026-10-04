import Link from "next/link";
import { LogoMark } from "./logo";
import { ProfileMenu } from "./profile-menu";

export function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <div className="flex h-12 items-center gap-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark size={28} />
          <span className="font-semibold tracking-tight">Life Stack</span>
        </Link>
        <div className="ml-auto">
          <ProfileMenu placement="header" />
        </div>
      </div>
    </header>
  );
}
