"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const REFRESH_INTERVAL = 5 * 60 * 1000;

export function SessionActivity() {
  const pathname = usePathname();
  const lastAttempt = useRef<number | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    function refresh() {
      if (document.visibilityState !== "visible" || pending.current) return;
      const now = Date.now();
      if (lastAttempt.current !== null && now - lastAttempt.current < REFRESH_INTERVAL) return;
      lastAttempt.current = now;
      pending.current = true;
      // Auth.js renews the JWT and its HttpOnly cookie through this endpoint.
      void fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
        .catch(() => { /* Retry on later activity after a temporary network failure. */ })
        .finally(() => { pending.current = false; });
    }

    const events = ["pointerdown", "keydown", "scroll", "focus"] as const;
    for (const event of events) window.addEventListener(event, refresh, { passive: true, capture: true });
    document.addEventListener("visibilitychange", refresh);
    // Visiting a page also counts as activity; there is no idle polling.
    refresh();
    return () => {
      for (const event of events) window.removeEventListener(event, refresh, { capture: true });
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pathname]);

  return null;
}
