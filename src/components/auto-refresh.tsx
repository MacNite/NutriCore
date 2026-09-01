"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders a server component on an interval while background work is running.
 *
 * Every AI feature is asynchronous now, so a page that shows "queued" would
 * otherwise stay on "queued" until the reader thought to reload it - which reads
 * as the feature being broken rather than as it being slow. A local model can
 * take minutes, so the interval is deliberately unhurried and stops on its own
 * after `maxMinutes`: a page nobody is watching should not poll for ever.
 */
export function AutoRefresh({
  intervalMs = 5000,
  maxMinutes = 30,
  label,
}: {
  intervalMs?: number;
  maxMinutes?: number;
  label?: string;
}) {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (stopped) return;
    const until = Date.now() + maxMinutes * 60_000;
    const timer = setInterval(() => {
      if (Date.now() > until) {
        setStopped(true);
        return;
      }
      // Only while the tab is actually being looked at.
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs, maxMinutes, stopped]);

  if (!label) return null;
  return (
    <p className="muted" aria-live="polite" style={{ margin: 0, fontSize: 13 }}>
      {label}
    </p>
  );
}
