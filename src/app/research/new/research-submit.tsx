"use client";

import { useFormStatus } from "react-dom";

/**
 * Submitting only queues the run, so the wait is short - but a slow database or
 * a slow network still leaves the page looking unchanged, which invites a second
 * submit and a second run. The pending state is what prevents that.
 */
export function ResearchSubmit({ label, pendingLabel, hint, disabled }: { label: string; pendingLabel: string; hint: string; disabled?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn btn-primary" disabled={disabled || pending} aria-busy={pending}>
        {pending ? pendingLabel : label}
      </button>
      <span role="status" aria-live="polite" className="muted" style={{ fontSize: 13 }}>
        {pending ? hint : ""}
      </span>
    </div>
  );
}
