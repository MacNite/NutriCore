"use client";

import { useId } from "react";

/**
 * A disclosure. By default it exists only on small screens: above the
 * breakpoint the toggle is hidden and the content always shows, so the desktop
 * layout is untouched; below it the content collapses behind the toggle.
 * `always` keeps the disclosure at every width, for a block that is detail
 * rather than the point of its card.
 *
 * The switch is pure CSS rather than a measured viewport, which keeps the
 * server and client markup identical and avoids a flash of the wrong state.
 * Open state is controlled so the panel can reveal itself when the reader taps
 * a chart, which is where its detail line lives.
 */
export function BodyFold({
  label,
  open,
  onToggle,
  always = false,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Collapse at every width, not just below the breakpoint. */
  always?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();

  return (
    <div className={always ? "body-fold body-fold-always" : "body-fold"}>
      <button
        type="button"
        className="body-fold-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <span>{label}</span>
        <span className="body-fold-chevron" aria-hidden="true" />
      </button>
      <div id={id} className="body-fold-content" data-open={open ? "true" : "false"}>
        {children}
      </div>
    </div>
  );
}
