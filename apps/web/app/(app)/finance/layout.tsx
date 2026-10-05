import type { ReactNode } from "react";
import { FinanceTabs } from "@/components/finance-tabs";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div>
      <PageHeader>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">Finance</h1>
        <FinanceTabs />
      </PageHeader>
      {children}
    </div>
  );
}
