"use client";

import { useEffect, useRef } from "react";

/** Shared native dialog with consistent focus restoration and mobile layout. */
export function AppDialog({ id, title, closeLabel, trigger, triggerLabel, triggerClassName = "btn btn-quiet", initialOpen = false, openEvent, onClose, secondaryTrigger, secondaryTriggerLabel, secondaryAutoFocusTarget, secondaryAutoClickTarget, children }: {
  id: string; title: string; closeLabel: string; trigger?: React.ReactNode;
  /** Name for a trigger that shows an icon instead of words. */
  triggerLabel?: string;
  triggerClassName?: string; initialOpen?: boolean;
  openEvent?: string; onClose?: () => void;
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
  // A dialog whose button sits somewhere else entirely - the quick-action menu
  // opens the day's activities this way - is reached by name instead, so that
  // the panel stays a single dialog rather than a second copy of the editor.
  useEffect(() => {
    if (!openEvent) return;
    const open = () => { if (!dialog.current?.open) dialog.current?.showModal(); };
    window.addEventListener(openEvent, open);
    return () => window.removeEventListener(openEvent, open);
  }, [openEvent]);
  return <>
    {trigger === undefined ? null : (
      <button ref={triggerButton} className={triggerClassName} type="button" aria-label={triggerLabel} title={triggerLabel} onClick={() => dialog.current?.showModal()}>{trigger}</button>
    )}
    {secondaryTrigger ? (
      <button className="icon-btn" type="button" onClick={() => {
        dialog.current?.showModal();
        if (secondaryAutoClickTarget) dialog.current?.querySelector<HTMLElement>(secondaryAutoClickTarget)?.click();
        if (secondaryAutoFocusTarget) requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>(secondaryAutoFocusTarget)?.focus());
      }} aria-label={secondaryTriggerLabel}>
        {secondaryTrigger}
      </button>
    ) : null}
    <dialog className="app-dialog" ref={dialog} aria-labelledby={`${id}-title`} onClose={() => { triggerButton.current?.focus(); onClose?.(); }}>
      <div className="app-dialog-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <button className="icon-btn" type="button" onClick={() => dialog.current?.close()} aria-label={closeLabel}><span aria-hidden="true">×</span></button>
      </div>
      <div className="app-dialog-body">{children}</div>
    </dialog>
  </>;
}
