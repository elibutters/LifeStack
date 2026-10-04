export function StatusMark({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
        ok ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"
      }`}
      aria-label={label}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {ok ? <path d="M3.5 8.5l3 3 6-6.5" /> : <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />}
      </svg>
    </span>
  );
}
