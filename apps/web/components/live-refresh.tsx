"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Keeps a page current when something else (the phone, a widget) changes the data: refreshes when the tab comes back into
// view, and every half minute while it is in view. The server re-renders; nothing here holds data.
export function LiveRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const go = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = setInterval(go, seconds * 1000);
    document.addEventListener("visibilitychange", go);
    window.addEventListener("focus", go);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", go); window.removeEventListener("focus", go); };
  }, [router, seconds]);
  return null;
}
