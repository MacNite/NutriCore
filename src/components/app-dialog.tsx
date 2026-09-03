"use client";

import { useEffect, useRef } from "react";

/** Shared native dialog with consistent focus restoration and mobile layout. */
export function AppDialog({ id, title, closeLabel, trigger, triggerClassName = "btn btn-quiet", initialOpen = false, secondaryTrigger, secondaryTriggerLabel, secondaryAutoFocusTarget, secondaryAutoClickTarget, children }: {
  id: string; title: string; closeLabel: string; trigger: React.ReactNode;
  triggerClassName?: string; initialOpen?: boolean;
  secondaryTrigger?: React.ReactNode; secondaryTriggerLabel?: string;
  secondaryAutoFocusTarget?: string;
  /** Control inside the dialog the secondary trigger presses on open, so the
      shortcut lands on the step it promises instead of the dialog's own start. */
  secondaryAutoClickTarget?: string;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const triggerButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (initialOpen && !dialog.current?.open) dialog.current?.showModal(); }, [initialOpen]);
  return <>
    <button ref={triggerButton} className={triggerClassName} type="button" onClick={() => dialog.current?.showModal()}>{trigger}</button>
    {secondaryTrigger ? (
      <button className="icon-btn" type="button" onClick={() => {
        dialog.current?.showModal();
        if (secondaryAutoClickTarget) dialog.current?.querySelector<HTMLElement>(secondaryAutoClickTarget)?.click();
        if (secondaryAutoFocusTarget) requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>(secondaryAutoFocusTarget)?.focus());
      }} aria-label={secondaryTriggerLabel}>
        {secondaryTrigger}
      </button>
    ) : null}
    <dialog className="app-dialog" ref={dialog} aria-labelledby={`${id}-title`} onClose={() => triggerButton.current?.focus()}>
      <div className="app-dialog-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <button className="icon-btn" type="button" onClick={() => dialog.current?.close()} aria-label={closeLabel}><span aria-hidden="true">×</span></button>
      </div>
      <div className="app-dialog-body">{children}</div>
    </dialog>
  </>;
}
