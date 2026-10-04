"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { renameAccount } from "@/app/(app)/settings/actions";
import { accountLabel } from "@/lib/finance-calc";

export function AccountNickname({
  id,
  name,
  nickname,
  kind,
}: {
  id: number;
  name: string;
  nickname: string | null;
  kind: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nick, setNick] = useState(nickname);
  const label = accountLabel({ name, nickname: nick });
  if (editing) {
    return (
      <form
        action={async (form) => {
          const next = String(form.get("nickname") ?? "");
          await renameAccount(id, next);
          setNick(next.trim() || null);
          setEditing(false);
          router.refresh();
        }}
        className="min-w-0 flex-1"
      >
        <input
          name="nickname"
          defaultValue={nick ?? ""}
          placeholder={name}
          maxLength={40}
          autoFocus
          aria-label="Account display name"
          className="h-8 w-full max-w-xs rounded-md border border-line bg-bg px-2 text-sm outline-none focus:border-accent"
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
        />
      </form>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="min-w-0 truncate text-left cursor-pointer hover:text-accent"
      title={nick ? `${name} — click to rename` : "Click to set a display name"}
    >
      {label}
      <span className="text-muted"> · {kind}</span>
    </button>
  );
}
