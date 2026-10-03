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
    <section className={`rounded-2xl border border-line bg-surface ${className}`}>
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
        {action}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}
