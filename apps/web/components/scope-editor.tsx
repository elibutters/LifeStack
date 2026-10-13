import { setTokenScopesAction } from "@/app/(app)/log/actions";
import { SCOPE_LABELS } from "@/lib/capture-core";

// Lets the owner change what an existing key can do. Keys keep working with their new permissions straight away.
export function ScopeEditor({ id, name, scopes }: { id: number; name: string; scopes: string[] }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm text-muted hover:text-fg">Permissions ({scopes.length})</summary>
      <form action={setTokenScopesAction.bind(null, id)} className="mt-2 space-y-1.5">
        {Object.entries(SCOPE_LABELS).map(([scope, label]) => (
          <label key={scope} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="scope" value={scope} defaultChecked={scopes.includes(scope)} className="h-4 w-4 accent-[var(--color-accent)]" />
            {label}
          </label>
        ))}
        <button type="submit" aria-label={`Save permissions for ${name}`} className="mt-1 h-8 rounded-md border border-line px-3 text-sm hover:bg-raised">Save permissions</button>
      </form>
    </details>
  );
}
