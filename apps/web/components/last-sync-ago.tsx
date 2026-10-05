"use client";

import { useEffect, useState } from "react";

const exactFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatAgo(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return "just now";
  if (h < 1) return `${m}m ago`;
  if (d < 1) return m % 60 ? `${h}h ${m % 60}m ago` : `${h}h ago`;
  if (d < 7) return h % 24 ? `${d}d ${h % 24}h ago` : `${d}d ago`;
  return `${d}d ago`;
}

export function LastSyncAgo({ at, phrase = "last sync" }: { at: string; phrase?: string }) {
  const [label, setLabel] = useState("");
  const [exact, setExact] = useState("");
  useEffect(() => {
    const d = new Date(at);
    const tick = () => {
      setLabel(formatAgo(Date.now() - d.getTime()));
      setExact(exactFmt.format(d));
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [at]);
  if (!label) return null;
  return (
    <time dateTime={at} title={exact} className="shrink-0 font-normal text-sm text-muted">
      ({phrase} {label})
    </time>
  );
}
