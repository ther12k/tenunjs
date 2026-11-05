/** Workout pilot fixture model and validators (in-memory; deterministic). */
import type { TextKeyboardType } from "@tenunjs/widgets";

export interface WorkoutSet {
  readonly id: string;
  readonly weight: number;
  readonly reps: number;
}

export interface WorkoutEntry {
  readonly id: string;
  readonly exerciseId: string;
  readonly name: string;
  readonly restSeconds: number;
  readonly sets: readonly WorkoutSet[];
}

export interface Workout {
  readonly id: string;
  readonly title: string;
  readonly entries: readonly WorkoutEntry[];
}

/** Rest countdown length for the focus journey (plan A3 foreground countdown). */
export const REST_DURATION_MS = 90_000;
export const WEIGHT_STEP_KG = 2.5;
export const REPS_STEP = 1;
export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 500;
export const REPS_MIN = 0;
export const REPS_MAX = 999;

export type NumericIntent = Extract<TextKeyboardType, "number" | "decimal">;

/**
 * Representative focus-journey fixture. `ex-bench` carries the ≥40-character
 * name the state matrix requires for label-reflow coverage.
 */
export const FOCUS_WORKOUT: Workout = {
  id: "workout-a",
  title: "Focus Workout",
  entries: [
    {
      id: "entry-1",
      exerciseId: "ex-bench",
      name: "Barbell bench press (medium grip, flat bench)",
      restSeconds: 90,
      sets: [
        { id: "set-1-1", weight: 60, reps: 8 },
        { id: "set-1-2", weight: 62.5, reps: 8 },
        { id: "set-1-3", weight: 65, reps: 6 },
      ],
    },
    {
      id: "entry-2",
      exerciseId: "ex-squat",
      name: "Back squat",
      restSeconds: 90,
      sets: [
        { id: "set-2-1", weight: 100, reps: 5 },
        { id: "set-2-2", weight: 100, reps: 5 },
        { id: "set-2-3", weight: 105, reps: 5 },
      ],
    },
  ],
};

/**
 * Lenient committed-value parse (plan A2): both "." and "," are decimal
 * separators, surrounding whitespace is ignored, and only a *complete*
 * number commits — drafts like "", "62." and "-" stay drafts (the framework
 * numeric gate keeps them admissible while editing).
 */
export function parseDecimalDraft(draft: string): number | null {
  const normalized = draft.trim().replace(/,/g, ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Canonical draft text for a number: no exponent, no trailing separator. */
export function formatWeight(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function formatReps(value: number): string {
  return String(Math.round(value));
}

/** mm:ss clock text for the countdown caption and rest.ring semantics value. */
export function formatClock(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Frozen action identifiers (docs/fixture-journeys.md). */
export function fieldAction(entryId: string, setId: string, field: "weight" | "reps"): string {
  return `workout.set.${entryId}.${setId}.field.${field}`;
}

export function stepAction(entryId: string, setId: string, field: "weight" | "reps", direction: "up" | "down"): string {
  return `workout.set.${entryId}.${setId}.step.${field}.${direction}`;
}

export function completeAction(entryId: string, setId: string): string {
  return `workout.set.${entryId}.${setId}.complete`;
}

export function statusSemantics(entryId: string, setId: string): string {
  return `workout.set.${entryId}.${setId}.status`;
}

/** Deterministic generator for the Milestone-B picker fixture volume (plan B1). */
export function generatedExerciseCount(recordCount: number): string[] {
  const names: string[] = [];
  const muscles = ["chest", "back", "legs", "shoulders", "arms", "core"];
  const equipment = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell"];
  for (let index = 0; index < recordCount; index++) {
    names.push(`${equipment[index % equipment.length]} ${muscles[index % muscles.length]} variation ${index}`);
  }
  return names;
}
