import type { ReactNode } from "react";

/** Sticky page chrome: title (and tabs) stay flush with the top while the rest scrolls. */
export function PageHeader({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 -mt-6 -ml-[max(1rem,env(safe-area-inset-left))] -mr-[max(1rem,env(safe-area-inset-right))] mb-6 border-b border-line bg-bg/95 pt-4 pb-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur md:top-0">
      {children}
    </header>
  );
}
