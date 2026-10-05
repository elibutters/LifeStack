import { redirect } from "next/navigation";
import { isValidMonth } from "@/lib/dates";

export default async function SpendingRedirect({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  redirect(isValidMonth(sp.m) ? `/finance/flow?m=${sp.m}` : "/finance/flow");
}
