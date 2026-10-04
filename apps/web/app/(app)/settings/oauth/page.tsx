"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { repairedFinance } from "../actions";
import { loadPlaid, PENDING_KEY, type Pending } from "@/lib/plaid-client";

// Plaid sends you back here after a bank's own sign-in page (OAuth). This resumes the same
// Link session and finishes saving the account.
export default function PlaidOAuthReturn() {
  const router = useRouter();
  const [message, setMessage] = useState("Finishing your connection...");

  useEffect(() => {
    let pending: Pending | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as Pending | null;
    } catch {}
    if (!pending) {
      setMessage("That connection expired. Go back to Connections and try again.");
      return;
    }
    const p = pending;
    loadPlaid()
      .then((Plaid) =>
        Plaid.create({
          token: p.token,
          receivedRedirectUri: window.location.href,
          onSuccess: async (publicToken) => {
            try {
              if (p.itemId) {
                if (!(await repairedFinance(p.itemId))) throw new Error("repair did not sync");
              } else {
                const r = await fetch("/api/connections/plaid/exchange", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ public_token: publicToken, kind: p.kind }),
                });
                if (!r.ok) throw new Error(String(r.status));
              }
              sessionStorage.removeItem(PENDING_KEY);
              router.replace("/connections");
            } catch {
              setMessage("Linked, but saving it failed. Go back to Connections and try again.");
            }
          },
          onExit: () => router.replace("/connections"),
        }).open(),
      )
      .catch(() => setMessage("Could not load the connection window. Go back to Connections and try again."));
  }, [router]);

  return <p className="py-10 text-center text-muted">{message}</p>;
}
