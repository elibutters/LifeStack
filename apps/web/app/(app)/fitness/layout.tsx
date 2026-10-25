import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FitnessTabs } from "@/components/fitness-tabs";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Fitness" };

export default async function FitnessLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div>
      <PageHeader>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">Fitness</h1>
        <FitnessTabs />
      </PageHeader>
      {children}
    </div>
  );
}
