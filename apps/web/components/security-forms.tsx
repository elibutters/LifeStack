"use client";

import { useActionState } from "react";
import { changeEmailAction, changePasswordAction, type SecurityState } from "@/app/(app)/security/actions";

const field = "h-11 w-full rounded-md border border-line bg-surface px-3 text-base outline-none focus:border-accent";
const button = "h-11 w-fit rounded-md bg-fg px-4 text-sm font-medium text-bg disabled:opacity-50";

function Result({ state }: { state: SecurityState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
      {state.done && <p className="text-sm text-green-300">{state.done}</p>}
    </>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<SecurityState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="grid max-w-sm gap-2">
      <input type="password" name="current" required autoComplete="current-password" placeholder="Current password" aria-label="Current password" className={field} />
      <input type="password" name="next" required minLength={12} autoComplete="new-password" placeholder="New password (12 or more characters)" aria-label="New password" className={field} />
      <input type="password" name="again" required minLength={12} autoComplete="new-password" placeholder="New password again" aria-label="New password again" className={field} />
      <button type="submit" disabled={pending} className={button}>Change password</button>
      <Result state={state} />
    </form>
  );
}

export function EmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<SecurityState, FormData>(changeEmailAction, {});
  return (
    <form action={action} className="grid max-w-sm gap-2">
      <input type="email" name="email" required defaultValue={email} autoComplete="username" aria-label="Email" className={field} />
      <input type="password" name="current" required autoComplete="current-password" placeholder="Current password" aria-label="Current password" className={field} />
      <button type="submit" disabled={pending} className={button}>Change email</button>
      <Result state={state} />
    </form>
  );
}
