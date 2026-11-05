import { ApplicationRuntime, type LayoutViewport } from "@tenunjs/widgets";
import { FocusScreen } from "./screens/focus.screen";
import { workoutDarkTheme, workoutDark, workoutLight, workoutTheme } from "./theme";

export const WORKOUT_VIEWPORT: Readonly<LayoutViewport> = Object.freeze({ width: 720, height: 1000 });

export interface WorkoutRuntimeOptions {
  /** Injected monotonic clock in ms (tests pass a controllable fake). */
  now?: () => number;
  /** Foreground scheduler for countdown ticks (tests capture callbacks). */
  schedule?: (callback: () => void, delayMs: number) => void;
}

/** One composition shared by the browser host, QuickJS, and journey tests. */
export function createWorkoutRuntime(
  viewport: LayoutViewport = WORKOUT_VIEWPORT,
  options: WorkoutRuntimeOptions = {},
): ApplicationRuntime {
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((callback, delayMs) => { setTimeout(callback, delayMs); });
  // TN-170: the runtime owns the theme; the toggle service swaps it through
  // the invalidation channel — no screen state, no remounts.
  let dark = false;
  // One owned countdown chain (review P2): every scheduling request
  // invalidates every earlier callback via a generation token, so
  // pause/resume cycles cannot multiply parallel chains, and a callback
  // that outlives the runtime stays inert instead of throwing.
  let restTimerGeneration = 0;
  const app: ApplicationRuntime = new ApplicationRuntime({
    screens: { focus: FocusScreen },
    initial: "focus",
    theme: workoutTheme,
    // TN-173: ColorRef props (colorSlot("error") etc.) bake against this
    // palette at the commit boundary; it swaps with the theme.
    palette: workoutLight,
    viewport,
    services: {
      now() {
        return now();
      },
      scheduleRestTick(delayMs: number) {
        const generation = ++restTimerGeneration;
        schedule(() => {
          if (generation !== restTimerGeneration || app.disposed) return;
          app.pushTo("focus", "restTick", now());
        }, delayMs);
      },
      toggleTheme() {
        dark = !dark;
        app.setTheme(dark ? workoutDarkTheme : workoutTheme);
        app.setPalette(dark ? workoutDark : workoutLight);
      },
    },
  });
  return app;
}
