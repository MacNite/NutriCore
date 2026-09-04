"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppDialog } from "./app-dialog";

/** One row of the menu. `href` navigates, `event` opens a dialog on this page. */
export interface QuickAction {
  key: "recipe" | "activity" | "body";
  label: string;
  href?: string;
  event?: string;
}

/** Icons and colours belong to the menu, not to the page that lists the rows. */
const ICONS: Record<string, string> = {
  meal: "✎",
  recipe: "≡",
  activity: "⚡",
  body: "⚖",
};

/**
 * The single floating button on Today. It used to be the quick meal alone,
 * which left every other way of recording a day - a recipe, a workout, a body
 * measurement - somewhere else entirely; the menu puts them one thumb-reach
 * apart and keeps the label out of a row it never lined up with.
 *
 * The quick meal is the only row that opens something here rather than
 * elsewhere, so its dialog is rendered next to the menu instead of behind a
 * link; with AI switched off the row is simply absent.
 */
export function QuickActionsFab({
  openLabel,
  closeLabel,
  menuLabel,
  actions,
  quickMeal,
}: {
  openLabel: string;
  closeLabel: string;
  menuLabel: string;
  actions: QuickAction[];
  quickMeal: {
    label: string;
    title: string;
    hint: string;
    dialogCloseLabel: string;
    initialOpen: boolean;
    children: React.ReactNode;
  } | null;
}) {
  const [open, setOpen] = useState(false);
  // Opened by the menu, and by the redirect an input error takes: a rejected
  // meal has to come back to the form it was typed into.
  const [mealOpen, setMealOpen] = useState(quickMeal?.initialOpen ?? false);
  const fab = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);
  const dismiss = () => {
    setOpen(false);
    fab.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The menu is a short list, so the first row is where the keyboard should
  // land; without this the focus stays on the button that opened it.
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [open]);

  return (
    <>
      {open ? <div className="fab-backdrop" aria-hidden="true" onClick={dismiss} /> : null}

      <div className="fab-stack">
        {open ? (
          <div className="fab-menu" ref={menu} aria-label={menuLabel} role="group">
            {quickMeal ? (
              <button
                className="fab-action"
                type="button"
                onClick={() => {
                  close();
                  setMealOpen(true);
                }}
              >
                <span className="fab-action-label">{quickMeal.label}</span>
                <span className="fab-action-icon" data-tone="meal" aria-hidden="true">{ICONS.meal}</span>
              </button>
            ) : null}

            {actions.map((action) =>
              action.href ? (
                <Link className="fab-action" key={action.key} href={action.href} onClick={close}>
                  <span className="fab-action-label">{action.label}</span>
                  <span className="fab-action-icon" data-tone={action.key} aria-hidden="true">{ICONS[action.key]}</span>
                </Link>
              ) : (
                <button
                  className="fab-action"
                  key={action.key}
                  type="button"
                  onClick={() => {
                    close();
                    if (action.event) window.dispatchEvent(new Event(action.event));
                  }}
                >
                  <span className="fab-action-label">{action.label}</span>
                  <span className="fab-action-icon" data-tone={action.key} aria-hidden="true">{ICONS[action.key]}</span>
                </button>
              ),
            )}
          </div>
        ) : null}

        <button
          ref={fab}
          className="fab fab-toggle"
          type="button"
          aria-expanded={open}
          aria-label={open ? closeLabel : openLabel}
          onClick={() => (open ? dismiss() : setOpen(true))}
        >
          <span aria-hidden="true">{open ? "×" : "＋"}</span>
        </button>
      </div>

      {quickMeal ? (
        <AppDialog
          id="quick-meal-dialog"
          title={quickMeal.title}
          closeLabel={quickMeal.dialogCloseLabel}
          initialOpen={mealOpen}
          onClose={() => {
            setMealOpen(false);
            // The dialog has no button of its own to hand focus back to.
            fab.current?.focus();
          }}
        >
          <p className="muted dialog-hint">{quickMeal.hint}</p>
          {quickMeal.children}
        </AppDialog>
      ) : null}
    </>
  );
}
