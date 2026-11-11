import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { ymd } from "@/lib/dates";
import { listTodos } from "@/lib/todos";
import { TodoBoard } from "./board";

export const metadata: Metadata = { title: "To do" };
export const dynamic = "force-dynamic";

export default async function TodosPage() {
  await requireSession();
  const items = await listTodos().catch(() => null);
  if (!items) {
    return (
      <>
        <PageHeader>
          <h1 className="text-3xl font-semibold tracking-tight">To do</h1>
        </PageHeader>
        <p className="text-sm text-danger">Couldn&apos;t load your list. Try again shortly.</p>
      </>
    );
  }
  return <TodoBoard items={items} today={ymd(new Date())} />;
}
