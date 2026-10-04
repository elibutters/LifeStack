import type { ReactNode } from "react";

export function Card({
  title,
  action,
  className = "",
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-md border border-line bg-surface ${className}`}>
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
        {action}
      </div>
      {/* Long titles and links scroll inside the card instead of widening the page. */}
      <div className="min-w-0 overflow-x-auto overscroll-x-contain px-4 pb-4">{children}</div>
    </section>
  );
}
