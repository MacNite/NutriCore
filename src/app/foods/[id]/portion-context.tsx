"use client";

import { createContext, useContext, useMemo, useState } from "react";

interface PortionState {
  quantity: string;
  unit: string;
  setQuantity: (value: string) => void;
  setUnit: (value: string) => void;
}

const PortionStateContext = createContext<PortionState | null>(null);

/**
 * Holds the portion the user is typing, so the log form and the nutrient table
 * show the same one. Without the shared state the table could only ever repeat
 * the food's own basis, which is not the amount being logged.
 */
export function PortionProvider({
  initialQuantity,
  initialUnit,
  children,
}: {
  initialQuantity: string;
  initialUnit: string;
  children: React.ReactNode;
}) {
  const [quantity, setQuantity] = useState(initialQuantity);
  const [unit, setUnit] = useState(initialUnit);
  const value = useMemo(() => ({ quantity, unit, setQuantity, setUnit }), [quantity, unit]);
  return <PortionStateContext.Provider value={value}>{children}</PortionStateContext.Provider>;
}

export function usePortion(): PortionState {
  const value = useContext(PortionStateContext);
  if (!value) throw new Error("usePortion must be used inside a PortionProvider");
  return value;
}

/** The typed quantity as a number, or NaN while the field is empty or unparseable. */
export const parseQuantity = (value: string) => Number.parseFloat(value.replace(",", "."));
