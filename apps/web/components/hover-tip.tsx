"use client";

import { useState, type ReactNode } from "react";

type Tip = { text: string; x: number; y: number };
type Pointer = { clientX: number; clientY: number };

export function HoverTip({ text, x, y }: Tip) {
  const flip = typeof window !== "undefined" && x > window.innerWidth - 260;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 max-w-60 rounded-md border border-line bg-raised px-2 py-1 text-xs text-fg shadow-lg"
      style={flip ? { left: x - 12, top: y + 12, transform: "translateX(-100%)" } : { left: x + 12, top: y + 12 }}
    >
      {text}
    </div>
  );
}

export function useHoverTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  return {
    tip,
    show: (text: string, e: Pointer) => setTip({ text, x: e.clientX, y: e.clientY }),
    move: (e: Pointer) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t)),
    hide: () => setTip(null),
  };
}

// Lets server-rendered charts have tooltips: mark any element data-tip="text" inside this wrapper.
// Mouse shows it on hover; touch shows it on tap and keeps it until the next tap elsewhere.
export function Tips({ children, className }: { children: ReactNode; className?: string }) {
  const hover = useHoverTip();
  const read = (e: React.PointerEvent) => (e.target as Element).closest?.("[data-tip]")?.getAttribute("data-tip") ?? null;
  const update = (e: React.PointerEvent) => {
    const text = read(e);
    if (text) hover.show(text, e);
    else hover.hide();
  };
  return (
    <div
      className={className}
      onPointerMove={(e) => e.pointerType === "mouse" && update(e)}
      onPointerDown={(e) => e.pointerType !== "mouse" && update(e)}
      onPointerLeave={(e) => e.pointerType === "mouse" && hover.hide()}
    >
      {children}
      {hover.tip && <HoverTip {...hover.tip} />}
    </div>
  );
}
