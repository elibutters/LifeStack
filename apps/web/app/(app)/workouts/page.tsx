import { redirect } from "next/navigation";

const RANGES = new Set(["26", "52", "all"]);

export default async function WorkoutsRedirect({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const r = (await searchParams).r;
  redirect(r && RANGES.has(r) ? `/fitness/running?r=${r}` : "/fitness/running");
}
