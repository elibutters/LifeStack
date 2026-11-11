import { setTokenScopesAction } from "@/app/(app)/log/actions";
import { SCOPE_LABELS, type Scope } from "@/lib/capture-core";

// Short chip labels, grouped. Every scope has to appear here: saving the form keeps only the boxes that are rendered.
const PLACED: Record<Scope, { group: string; label: string }> = {
  "log:write": { group: "Log", label: "Add" },
  "log:read": { group: "Log", label: "Read today" },
  "calendar:read": { group: "Read", label: "Calendar" },
  "sleep:read": { group: "Read", label: "Sleep" },
  "finance:read": { group: "Read", label: "Finances" },
  "fitness:read": { group: "Read", label: "Workouts" },
  "email:read": { group: "Read", label: "Mail" },
  "amazon:write": { group: "Amazon", label: "Send snapshots" },
  "location:read": { group: "Places", label: "History" },
  "location:write": { group: "Places", label: "Name places" },
  "notes:read": { group: "Notion", label: "Read" },
  "notes:write": { group: "Notion", label: "Add pages" },
  "goals:read": { group: "Goals", label: "Read" },
  "goals:write": { group: "Goals", label: "Change" },
  "settings:read": { group: "Preferences", label: "Read" },
  "settings:write": { group: "Preferences", label: "Change" },
  "account:read": { group: "Account", label: "Connections" },
};

const GROUP_ORDER = ["Log", "Read", "Places", "Notion", "Goals", "Preferences", "Account", "Amazon"];

const GROUPS = GROUP_ORDER.map((title) => ({
  title,
  items: (Object.entries(PLACED) as [Scope, { group: string; label: string }][]).filter(([, v]) => v.group === title),
}));

// Lets the owner change what an existing key can do. Keys keep working with their new permissions straight away.
export function ScopeEditor({ id, name, scopes, phone }: { id: number; name: string; scopes: string[]; phone: boolean }) {
  return (
    <details className="group mt-3">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">▸</span>
        <span>Permissions</span>
        <span className="rounded-md bg-raised px-1.5 py-0.5 text-xs tabular-nums text-muted">{scopes.length} on</span>
      </summary>
      <form action={setTokenScopesAction.bind(null, id)} className="mt-2 rounded-md border border-line bg-bg px-3 py-1">
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title} className="min-w-0 py-2.5">
              <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">{g.title}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map(([scope, item]) => (
                  <label key={scope} className="cursor-pointer">
                    <input type="checkbox" name="scope" value={scope} defaultChecked={scopes.includes(scope)} aria-label={SCOPE_LABELS[scope] ?? item.label} className="peer sr-only" />
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-sm text-muted peer-checked:border-accent/50 peer-checked:bg-accent-deep peer-checked:text-accent-soft peer-focus-visible:outline peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-checked:[&>.dot]:bg-accent peer-checked:[&>.dot]:opacity-100">
                      <span className="dot size-1.5 rounded-full bg-current opacity-35" />
                      {item.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2.5">
          {phone ? <p className="text-xs text-muted">Until you save here, a phone key follows the app&apos;s default permissions.</p> : <span />}
          <button type="submit" aria-label={`Save permissions for ${name}`} className="h-8 rounded-md bg-fg px-3 text-sm font-medium text-bg">
            Save
          </button>
        </div>
      </form>
    </details>
  );
}
