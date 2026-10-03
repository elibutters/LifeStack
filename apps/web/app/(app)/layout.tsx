import type { ReactNode } from "react";
import { MobileNav } from "@/components/nav";
import { TopBar } from "@/components/top-bar";
import { requireSession } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <main className="mx-auto w-full max-w-6xl flex-1 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-10">
        {children}
      </main>
      <MobileNav />
    </div>
  );
}
