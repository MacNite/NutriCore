"use client";

import { useState } from "react";

/**
 * Shows a value that has to leave NutriCore by hand — currently an invitation
 * link. The value stays selectable so copying still works where the clipboard
 * API is unavailable (an http:// origin on a LAN, for instance).
 */
export function CopyField({
  value,
  label,
  copyLabel,
  copiedLabel,
}: {
  value: string;
  label: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied or unavailable: the input is selectable, so leave the
      // label alone rather than claiming a copy that did not happen.
    }
  }

  return (
    <div className="copy-field">
      <input readOnly value={value} onFocus={(event) => event.currentTarget.select()} aria-label={label} />
      <button type="button" className="btn btn-quiet" onClick={copy}>
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}
