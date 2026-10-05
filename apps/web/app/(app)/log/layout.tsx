import type { ReactNode } from "react";
import { LogTabs } from "@/components/log-tabs";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";

export default async function LogLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div>
      <PageHeader>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">Log</h1>
        <LogTabs />
      </PageHeader>
      <div className="max-w-3xl">{children}</div>
    </div>
  );
}
