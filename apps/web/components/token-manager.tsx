"use client";

import { useActionState, useState } from "react";
import { createTokenAction, revokeTokenAction, type TokenState } from "@/app/(app)/log/actions";

const field = "h-11 w-full rounded-md border border-line bg-surface px-3 text-base outline-none focus:border-accent";

export function CreateTokenForm() {
  const [state, action, pending] = useActionState<TokenState, FormData>(createTokenAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      {state.token && (
        <div className="rounded-md border border-accent/40 bg-accent/10 p-3">
          <p className="text-sm">
            Key for <strong>{state.name}</strong>. Copy it now; it is shown only once and cannot be looked up again.
          </p>
          <div className="mt-2 flex gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-surface px-3 py-2 text-sm whitespace-nowrap">{state.token}</code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(state.token!);
                setCopied(true);
              }}
              className="h-11 shrink-0 rounded-md border border-line px-4 text-sm hover:bg-raised"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
      <form action={action} onSubmit={() => setCopied(false)} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <input name="name" required maxLength={60} placeholder="Name, such as My iPhone" aria-label="Name" className={`${field} sm:col-span-2`} />
        <select name="kind" aria-label="Kind" defaultValue="shortcut" className={field}>
          <option value="shortcut">iPhone Shortcut</option>
          <option value="widget">Widget or app</option>
          <option value="agent">Agent</option>
        </select>
        <select name="access" aria-label="Access" defaultValue="write" className={field}>
          <option value="write">Can only add logs</option>
          <option value="readwrite">Can add and read today</option>
          <option value="agent">Agent: read everything and add logs</option>
        </select>
        <button type="submit" disabled={pending} className="h-11 rounded-md bg-fg px-4 text-sm font-medium text-bg disabled:opacity-50 sm:col-span-4 sm:w-fit">Create key</button>
      </form>
      {state.error && <p className="text-sm text-red-300">{state.error}</p>}
    </div>
  );
}

export function RevokeButton({ id, name }: { id: number; name: string }) {
  return (
    <form action={revokeTokenAction.bind(null, id)}>
      <button type="submit" aria-label={`Revoke ${name}`} className="h-9 rounded-md border border-line px-3 text-sm text-red-300 hover:bg-raised">Revoke</button>
    </form>
  );
}
