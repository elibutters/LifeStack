import type { Metadata } from "next";
import { Card } from "@/components/card";
import { requireSession } from "@/lib/auth";
import { TZ } from "@/lib/dates";
import { fieldValue, PROFILE_SECTIONS, type Profile, type ProfileField } from "@/lib/profile-core";
import { loadProfile } from "@/lib/profile";
import { saveProfile } from "./actions";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const input = "h-11 w-full rounded-md border border-line bg-bg px-3 text-sm outline-none focus:border-accent";
const area = "min-h-24 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const profile = await loadProfile().catch(() => ({}) as Profile);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          This is what a new agent reads first. Values live only in the database. Fill in what is useful; blank fields are
          omitted from the API.
        </p>
      </div>

      {sp.saved === "1" && (
        <p className="max-w-2xl rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-accent">Saved. Agents will see the filled-in fields.</p>
      )}
      {sp.error === "invalid" && (
        <p className="max-w-2xl rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-300">
          That did not look right. Check dates and numbers (height in cm, weight in kg).
        </p>
      )}

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
        <p className="mt-2 text-sm text-muted">Timezone comes from the app setting, not this form.</p>
      </Card>

      <form action={saveProfile} className="max-w-2xl space-y-6">
        {PROFILE_SECTIONS.map((section) => (
          <Card key={section.title} title={section.title}>
            <p className="mb-4 text-sm text-muted">{section.blurb}</p>
            <div className="space-y-3">
              {section.fields.map((field) => (
                <Field key={field.key} field={field} value={fieldValue(profile, field.key)} />
              ))}
            </div>
          </Card>
        ))}
        <button type="submit" className="h-11 rounded-md bg-fg px-4 text-sm font-medium text-bg">
          Save profile
        </button>
      </form>
    </div>
  );
}

function Field({ field, value }: { field: ProfileField; value: string }) {
  const id = `profile-${field.key}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm">
        {field.label}
      </label>
      {field.hint && <p className="mb-1 text-xs text-muted">{field.hint}</p>}
      {field.kind === "textarea" ? (
        <textarea id={id} name={field.key} maxLength={field.max} defaultValue={value} rows={4} className={area} />
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
