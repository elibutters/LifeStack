import type { ReactNode } from "react";

/** Sticky page chrome: title (and tabs) stay flush with the top while the rest scrolls. */
export function PageHeader({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 -mx-4 -mt-6 mb-6 border-b border-line bg-bg/95 px-4 pt-4 pb-3 backdrop-blur md:top-0">
      {children}
    </header>
  );
}
