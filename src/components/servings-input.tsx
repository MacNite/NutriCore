"use client";

import { useRef } from "react";

/**
 * A number field with its own stepper buttons.
 *
 * The native spinner is not usable here: it only shows on hover in a desktop
 * browser and is absent altogether from the installed PWA, and its step is tied
 * to `step`, which has to allow decimals so "1,13 Portionen" can be typed. So
 * the buttons are drawn beside the field, always visible, and they step in whole
 * portions - 1, 2, 3 - which is what they are used for; a fractional serving is
 * still typed straight into the field.
 *
 * The field stays uncontrolled: React re-renders a controlled number input from
 * a value the browser reports as empty while a decimal separator is half typed,
 * which is exactly the free-text case this has to keep working.
 */
export function ServingsInput({
  id,
  name,
  label,
  hint,
  defaultValue = 1,
  min = 0.01,
  max = 10_000,
  decrementLabel,
  incrementLabel,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  defaultValue?: number;
  min?: number;
  max?: number;
  decrementLabel: string;
  incrementLabel: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = `${id}-hint`;

  /**
   * Whole portions in the direction of travel: up from 1,13 is 2, down is 1.
   * An empty or unreadable field starts from one rather than from nothing.
   */
  const step = (direction: 1 | -1) => {
    const field = input.current;
    if (!field) return;
    const parsed = Number(field.value.replace(",", "."));
    if (!Number.isFinite(parsed) || field.value.trim() === "") {
      field.value = "1";
      return;
    }
    const next = direction === 1 ? Math.floor(parsed) + 1 : Math.ceil(parsed) - 1;
    field.value = String(Math.min(max, Math.max(1, next)));
  };

  return (
    <div className="field servings-field">
      <label htmlFor={id}>{label}</label>
      <div className="servings-control">
        <button type="button" className="btn servings-step" onClick={() => step(-1)} aria-label={decrementLabel}>
          <span aria-hidden="true">−</span>
        </button>
        <input
          ref={input}
          id={id}
          name={name}
          type="number"
          inputMode="decimal"
          // The field itself still accepts decimals; only the buttons round.
          step="0.01"
          min={min}
          max={max}
          required
          defaultValue={defaultValue}
          aria-describedby={hintId}
        />
        <button type="button" className="btn servings-step" onClick={() => step(1)} aria-label={incrementLabel}>
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <span className="hint" id={hintId}>{hint}</span>
    </div>
  );
}
