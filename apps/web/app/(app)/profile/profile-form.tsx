"use client";

import { createContext, useEffect, useRef, useState, type ReactNode } from "react";

export const ProfileEditContext = createContext<() => void>(() => {});

function snapshot(form: HTMLFormElement) {
  return [...new FormData(form).entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([key, value]) => `${key}=${value}`).join("\n");
}

export function ProfileForm({ action, children }: { action: (form: FormData) => Promise<void>; children: ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const saved = useRef("");
  const [dirty, setDirty] = useState(false);

  const check = () => {
    const node = form.current;
    if (!node) return;
    setDirty(snapshot(node) !== saved.current);
  };

  useEffect(() => {
    if (form.current) saved.current = snapshot(form.current);
  }, []);

  return (
    <ProfileEditContext.Provider value={check}>
    <form ref={form} action={action} onInput={check} onChange={check} className={`max-w-4xl space-y-4 ${dirty ? "pb-16" : ""}`}>
      {children}
      {dirty && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-bg px-[max(1rem,env(safe-area-inset-left))] py-2 md:inset-x-auto md:right-6 md:bottom-6 md:w-auto md:border-0 md:bg-transparent md:p-0">
          <button type="submit" className="h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg">
            Save profile
          </button>
        </div>
      )}
    </form>
    </ProfileEditContext.Provider>
  );
}
