export interface Workout {
  id: string;
  name: string;
  minutes: number;
  kcal: number;
  glyph: string;
  tint: string;
}

export const WORKOUTS: ReadonlyArray<Workout> = [
  { id: "run", name: "Morning run", minutes: 32, kcal: 310, glyph: "↗", tint: "#263D62" },
  { id: "yoga", name: "Sunrise flow", minutes: 24, kcal: 180, glyph: "✦", tint: "#4E3A59" },
  { id: "cycle", name: "City cycling", minutes: 42, kcal: 360, glyph: "⌁", tint: "#2E514B" },
];

export const FITNESS_WEEK = [
  { day: "Mon", steps: 6100 },
  { day: "Tue", steps: 9400 },
  { day: "Wed", steps: 5200 },
  { day: "Thu", steps: 8100 },
  { day: "Fri", steps: 4820 },
  { day: "Sat", steps: 0 },
  { day: "Sun", steps: 0 },
] as const;
