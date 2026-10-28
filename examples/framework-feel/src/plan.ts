export const PLAN_TASKS = Object.freeze([
  "Review layout",
  "Check interactions",
  "Record a demo",
] as const);

export type PlanRoute = "today" | "progress";

export function checkedCompleted(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > PLAN_TASKS.length) {
    throw new TypeError("Day Plan completion must be an integer between 0 and 3");
  }
  return value;
}

/** The current runtime injects services into action contexts. */
export function navigatePlan(
  services: Record<string, unknown>,
  route: PlanRoute,
  completed?: number,
): void {
  const navigate = services.navigate;
  if (typeof navigate !== "function") throw new TypeError("Day Plan requires a navigation service");
  navigate(route, completed);
}
