"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function Login() {
  const [error, action, pending] = useActionState(login, null);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xs flex-col justify-center p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="text-2xl font-semibold">Life Stack</h1>
      <form action={action} className="mt-6 flex flex-col gap-3">
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
          required
          className="rounded-md border border-line bg-surface px-3 py-2.5 text-base outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-fg px-3 py-2.5 font-medium text-bg disabled:opacity-50"
        >
          Sign in
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </main>
  );
}
