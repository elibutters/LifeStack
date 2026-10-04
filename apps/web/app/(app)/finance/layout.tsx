import type { ReactNode } from "react";
import { FinanceTabs } from "@/components/finance-tabs";
import { requireSession } from "@/lib/auth";

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div>
      <h1 className="mb-4 text-3xl font-semibold tracking-tight">Finance</h1>
      <FinanceTabs />
      {children}
    </div>
  );
}
