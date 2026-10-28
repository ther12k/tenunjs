export const PLAN_TASKS = Object.freeze([
  "Review layout",
  "Check interactions",
  "Record a demo",
] as const);

export type PlanRoute = "today" | "progress";

/** Additive state default for Day Plan snapshots created before title editing. */
export const defaultPlanTitle = "Release day";

export interface PlanProgress {
  readonly completed: number;
  readonly planTitle: string;
}

export function checkedCompleted(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > PLAN_TASKS.length) {
    throw new TypeError("Day Plan completion must be an integer between 0 and 3");
  }
  return value;
}

export function checkedPlanTitle(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Day Plan title must be a string");
  return value;
}

export function checkedPlanProgress(value: unknown): PlanProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Day Plan progress must contain a completion count and title");
  }
  const progress = value as Partial<PlanProgress>;
  return { completed: checkedCompleted(progress.completed), planTitle: checkedPlanTitle(progress.planTitle) };
}

/** The current runtime injects services into action contexts. */
export function navigatePlan(
  services: Record<string, unknown>,
  route: PlanRoute,
  progress?: PlanProgress,
): void {
  const navigate = services.navigate;
  if (typeof navigate !== "function") throw new TypeError("Day Plan requires a navigation service");
  navigate(route, progress);
}
