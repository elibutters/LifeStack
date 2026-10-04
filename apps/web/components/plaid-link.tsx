"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { repairedFinance } from "@/app/(app)/settings/actions";
import { loadPlaid, PENDING_KEY, type Pending } from "@/lib/plaid-client";

function explain(j: { error?: string; code?: string }): string {
  if (j.error === "not_configured") return "Plaid is not set up on this deployment.";
  if (j.code === "INVALID_API_KEYS") return "Plaid rejected this app's keys. Check the client ID and secret in Vercel.";
  if (j.code) return `Plaid could not start the connection (${j.code}).`;
  return "Could not start the connection. Try again.";
}

// Opens Plaid's secure window. Bank logins are typed into Plaid's window, never into this app.
export function PlaidLinkButton({
  kind,
  itemId,
  addInvestments,
  label,
  className,
}: {
  kind: "bank" | "brokerage";
  itemId?: string;
  addInvestments?: boolean;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connections/plaid/link-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, itemId, addInvestments }),
      });
      if (!res.ok) {
        setError(explain((await res.json().catch(() => ({}))) as { error?: string; code?: string }));
        setBusy(false);
        return;
      }
      const { link_token } = (await res.json()) as { link_token: string };
      // Banks that use OAuth send the browser away and back; remember what we were doing.
      const pending: Pending = { token: link_token, kind, itemId };
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      const Plaid = await loadPlaid();
      Plaid.create({
        token: link_token,
        onSuccess: async (publicToken) => {
          try {
            if (itemId) {
              if (!(await repairedFinance(itemId))) throw new Error("repair did not sync");
            } else {
              const r = await fetch("/api/connections/plaid/exchange", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ public_token: publicToken, kind }),
              });
              if (!r.ok) throw new Error(String(r.status));
            }
            sessionStorage.removeItem(PENDING_KEY);
            router.refresh();
          } catch {
            setError("Linked, but saving it failed. Try again.");
          } finally {
            setBusy(false);
          }
        },
        onExit: () => setBusy(false),
      }).open();
    } catch {
      setError("Could not start the connection. Try again.");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={start} disabled={busy} className={className}>
        {busy ? "Opening..." : label}
      </button>
      {error && <span className="text-sm text-red-300">{error}</span>}
    </span>
  );
}
