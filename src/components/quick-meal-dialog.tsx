"use client";

import { AppDialog } from "./app-dialog";

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
  return (
    <AppDialog id="quick-meal-dialog" title={title} closeLabel={closeLabel} initialOpen={initialOpen} triggerClassName="fab" trigger={<><span aria-hidden="true">＋</span>{triggerLabel}</>}>
        <p className="muted dialog-hint">{hint}</p>
        {children}
    </AppDialog>
  );
}
