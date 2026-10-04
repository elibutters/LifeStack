import type { ReactNode } from "react";
import { MobileNav } from "@/components/nav";
import { Sidebar } from "@/components/sidebar";
import { MobileHeader } from "@/components/top-bar";
import { requireSession } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="min-h-dvh md:flex">
      <Sidebar />
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-10">
          {children}
        </main>
        <MobileNav />
      </div>
    </div>
  );
}
