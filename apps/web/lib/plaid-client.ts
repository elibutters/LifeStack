// Browser-side loader for Plaid's Link window.
export type LinkHandler = { open: () => void };
export type LinkConfig = {
  token: string;
  receivedRedirectUri?: string;
  onSuccess: (publicToken: string) => void;
  onExit: () => void;
};
declare global {
  interface Window {
    Plaid?: { create: (c: LinkConfig) => LinkHandler };
  }
}

let loading: Promise<NonNullable<Window["Plaid"]>> | null = null;

export function loadPlaid() {
  loading ??= new Promise((resolve, reject) => {
    if (window.Plaid) return resolve(window.Plaid);
    const s = document.createElement("script");
    s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error("Plaid failed to load")));
    s.onerror = () => reject(new Error("Plaid failed to load"));
    document.head.appendChild(s);
  });
  return loading;
}

export const PENDING_KEY = "ls_plaid";
export type Pending = { token: string; kind: "bank" | "brokerage"; itemId?: string };
