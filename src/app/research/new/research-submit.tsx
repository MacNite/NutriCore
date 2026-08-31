"use client";

import { useFormStatus } from "react-dom";

/**
 * The model call runs inside the request, so the form can sit for a minute or
 * more. Without a pending state the page looks unchanged and invites a second
 * submit, which would start a second run.
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
