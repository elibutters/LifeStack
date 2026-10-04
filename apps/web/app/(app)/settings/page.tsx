import { redirect } from "next/navigation";

export default async function SettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") q.set(k, v);
    else if (Array.isArray(v)) for (const item of v) q.append(k, item);
  }
  const s = q.toString();
  redirect(s ? `/connections?${s}` : "/connections");
}
