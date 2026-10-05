import type { Metadata } from "next";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { fieldValue, PROFILE_SECTIONS, type Profile, type ProfileField } from "@/lib/profile-core";
import { loadProfile } from "@/lib/profile";
import { saveProfile } from "./actions";
import { ContactList } from "./contact-list";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const input = "h-9 w-full min-w-0 rounded-md border border-line bg-bg px-2.5 text-sm outline-none focus:border-accent";
const area = "min-h-16 w-full min-w-0 rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const profile = await loadProfile().catch(() => ({}) as Profile);

  return (
    <>
      <PageHeader>
        <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
      </PageHeader>
      <div className="space-y-6">

      {sp.saved === "1" && (
        <p className="max-w-4xl rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-accent">Saved. Agents will see the filled-in fields.</p>
      )}
      {sp.error === "invalid" && (
        <p className="max-w-4xl rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-danger">
          That did not look right. Check dates and numbers (height in feet and inches, weight in pounds).
        </p>
      )}

      <form action={saveProfile} className="max-w-4xl space-y-4">
        {PROFILE_SECTIONS.map((section) => (
          <Card key={section.title} title={section.title}>
            <p className="mb-2 text-sm text-muted">{section.blurb}</p>
            {section.title === "Contact" && <ContactList items={profile.contacts ?? []} />}
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {section.fields.map((field) => (
                <Field key={field.key} field={field} value={fieldValue(profile, field.key)} />
              ))}
            </div>
          </Card>
        ))}
        <button type="submit" className="h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg">
          Save profile
        </button>
      </form>
    </div>
    </>
  );
}

function Field({ field, value }: { field: ProfileField; value: string }) {
  const id = `profile-${field.key}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-0.5 block text-xs text-muted">
        {field.label}
      </label>
      {field.hint && <p className="mb-0.5 text-xs text-muted">{field.hint}</p>}
      {field.kind === "textarea" ? (
        <textarea id={id} name={field.key} maxLength={field.max} defaultValue={value} rows={2} className={area} />
      ) : field.kind === "select" ? (
        <select id={id} name={field.key} defaultValue={value} className={input}>
          <option value="">Not set</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={field.key}
          type={field.kind === "number" ? "number" : field.kind}
          step={field.step}
          maxLength={field.max}
          defaultValue={value}
          className={input}
        />
      )}
    </div>
  );
}
