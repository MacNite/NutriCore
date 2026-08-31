import { formatDateKey } from "@/server/diary";

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validDateKey(value: string | undefined, fallback = formatDateKey(new Date())) {
  if (!value || !DATE_KEY_PATTERN.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || formatDateKey(parsed) !== value ? fallback : value;
}

export function shiftDateKey(date: string, days: number) {
  return formatDateKey(new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * 86_400_000));
}
