"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function Login() {
  const [error, action, pending] = useActionState(login, null);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xs flex-col justify-center p-6">
      <h1 className="text-2xl font-semibold">Life Stack</h1>
      <form action={action} className="mt-6 flex flex-col gap-3">
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
          required
          className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-100 px-3 py-2 font-medium text-neutral-900 disabled:opacity-50"
        >
          Sign in
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </main>
  );
}
