"use client";

import { useEffect, useRef } from "react";

export function QuickMealDialog({
  triggerLabel,
  title,
  hint,
  closeLabel,
  initialOpen = false,
  children,
}: {
  triggerLabel: string;
  title: string;
  hint: string;
  closeLabel: string;
  initialOpen?: boolean;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (initialOpen && !dialog.current?.open) dialog.current?.showModal();
  }, [initialOpen]);

  return (
    <>
      <button className="fab" type="button" onClick={() => dialog.current?.showModal()}>
        <span aria-hidden="true">＋</span>
        {triggerLabel}
      </button>
      <dialog className="quick-meal-dialog" ref={dialog} aria-labelledby="quick-meal-dialog-title">
        <div className="card-head">
          <div>
            <h2 id="quick-meal-dialog-title">{title}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {hint}
            </p>
          </div>
          <button className="icon-btn" type="button" onClick={() => dialog.current?.close()} aria-label={closeLabel}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {children}
      </dialog>
    </>
  );
}
