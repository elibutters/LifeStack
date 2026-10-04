import type { ReactNode } from "react";
import { LogTabs } from "@/components/log-tabs";
import { requireSession } from "@/lib/auth";

export default async function LogLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-3xl font-semibold tracking-tight">Log</h1>
      <LogTabs />
      {children}
    </div>
  );
}
