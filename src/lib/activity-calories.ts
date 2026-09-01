export interface ExerciseEnergy {
  grossKcal: number;
  activeKcal: number;
}

/** Gross and net (above resting) energy from the standard MET equation. */
export function calculateExerciseEnergy(met: number, weightKg: number, durationMinutes: number): ExerciseEnergy {
  if (![met, weightKg, durationMinutes].every(Number.isFinite) || met <= 0 || weightKg <= 0 || durationMinutes <= 0) {
    throw new RangeError("MET, weight and duration must be finite positive values");
  }
  const factor = (3.5 * weightKg * durationMinutes) / 200;
  return { grossKcal: met * factor, activeKcal: Math.max(0, met - 1) * factor };
}
