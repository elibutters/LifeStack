export function StatusMark({ ok, label, choice = false }: { ok: boolean; label?: string; choice?: boolean }) {
  const showCheck = ok;
  const showCross = !ok && !choice;
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
        choice
          ? ok
            ? "bg-ok text-ok-fg"
            : "bg-idle"
          : ok
            ? "bg-ok/15 text-ok"
            : "bg-danger/15 text-danger"
      }`}
      aria-hidden={choice ? true : undefined}
      aria-label={choice ? undefined : label}
    >
      {showCheck || showCross ? (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {showCheck ? <path d="M3.5 8.5l3 3 6-6.5" /> : <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />}
        </svg>
      ) : null}
    </span>
  );
}
