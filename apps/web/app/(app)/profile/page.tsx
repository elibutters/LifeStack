import type { Metadata } from "next";
import { Card } from "@/components/card";
import { requireSession } from "@/lib/auth";
import { TZ } from "@/lib/dates";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  await requireSession();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
      <Card title="Account" className="max-w-2xl">
        <dl className="divide-y divide-line">
          <div className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-muted">Status</dt>
            <dd>Signed in</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-muted">Timezone</dt>
            <dd className="tabular-nums">{TZ}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
