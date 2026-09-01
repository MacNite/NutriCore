"use client";

import { useEffect, useRef } from "react";

/** Shared native dialog with consistent focus restoration and mobile layout. */
export function AppDialog({ id, title, closeLabel, trigger, triggerClassName = "btn btn-quiet", initialOpen = false, children }: {
  id: string; title: string; closeLabel: string; trigger: React.ReactNode;
  triggerClassName?: string; initialOpen?: boolean; children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const triggerButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (initialOpen && !dialog.current?.open) dialog.current?.showModal(); }, [initialOpen]);
  return <>
    <button ref={triggerButton} className={triggerClassName} type="button" onClick={() => dialog.current?.showModal()}>{trigger}</button>
    <dialog className="app-dialog" ref={dialog} aria-labelledby={`${id}-title`} onClose={() => triggerButton.current?.focus()}>
      <div className="app-dialog-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <button className="icon-btn" type="button" onClick={() => dialog.current?.close()} aria-label={closeLabel}><span aria-hidden="true">×</span></button>
      </div>
      <div className="app-dialog-body">{children}</div>
    </dialog>
  </>;
}
