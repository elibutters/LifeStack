import type { Metadata } from "next";
import { Card } from "@/components/card";
import { EmailForm, PasswordForm } from "@/components/security-forms";
import { currentUserId, requireSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";

export const metadata: Metadata = { title: "Security" };
export const dynamic = "force-dynamic";

export default async function Security() {
  await requireSession();
  const id = await currentUserId();
  const user = id ? await findUserById(id).catch(() => null) : null;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Security</h1>
      {user ? (
        <div className="max-w-2xl space-y-4">
          <Card title="Email">
            <EmailForm email={user.email} />
          </Card>
          <Card title="Password">
            <p className="mb-3 text-sm text-muted">Changing it signs your phone out. Shortcut and agent keys keep working until you revoke them.</p>
            <PasswordForm />
          </Card>
        </div>
      ) : (
        <Card title="Accounts" className="max-w-2xl">
          <p className="text-sm text-muted">Accounts are not turned on for this deployment. Set OWNER_EMAIL, then sign in with that email to create yours; after that you can change your email and password here.</p>
        </Card>
      )}
    </div>
  );
}
