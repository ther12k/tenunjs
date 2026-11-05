/**
 * QuickJS bundle entry for the workout pilot: packages createWorkoutRuntime
 * for native Android execution behind installHostHandoff, with the
 * setTimeout shim the rest countdown's tick chain needs (QuickJS has no
 * timer globals; the host scheduler re-enters this dispatch entry, which
 * drains due callbacks — the polytron-entry precedent).
 */
import { installHostHandoff } from "@tenunjs/widgets";
import { createWorkoutRuntime } from "./runtime";

const host = globalThis as Record<string, unknown>;

interface ActiveTimer {
  id: number;
  runAt: number;
  fn: () => void;
}

let nextTimerId = 1;
const activeTimers = new Map<number, ActiveTimer>();

function drainTimers(): void {
  const now = Date.now();
  for (const [id, timer] of Array.from(activeTimers.entries())) {
    if (now >= timer.runAt) {
      activeTimers.delete(id);
      try {
        timer.fn();
      } catch {
        // Keep draining; a rejected tick must not starve the others.
      }
    }
  }
}

if (typeof (host as { setTimeout?: unknown }).setTimeout !== "function") {
  (host as { setTimeout: (fn: () => void, ms?: number) => number }).setTimeout = (
    fn: () => void,
    ms: number = 0,
  ) => {
    const id = nextTimerId++;
    const delay = Math.max(0, ms);
    activeTimers.set(id, { id, runAt: Date.now() + delay, fn });
    if (typeof host.tenun_host_call === "function") {
      try {
        (host.tenun_host_call as (s: string, m: string, p: string) => string | null)(
          "system",
          "scheduleTimer",
          JSON.stringify({ delayMs: delay }),
        );
      } catch {
        // Host scheduler optional; dispatch entry drains automatically.
      }
    }
    return id;
  };
  (host as { clearTimeout: (id: number) => void }).clearTimeout = (id: number) => {
    activeTimers.delete(id);
  };
}

const app = createWorkoutRuntime();
const handoff = installHostHandoff({
  app,
  commit(json) {
    const sink = host["tenun_commit"];
    if (typeof sink === "function") sink(json);
    else host["__tenun_last_scene"] = json;
  },
});

host["__tenun_dispatch_action"] = (action: string, payloadJson: string): string => {
  drainTimers();
  // The host scheduler's re-entry verb: due callbacks already ran above.
  if (action.toUpperCase() === "TIMER") {
    return JSON.stringify({ route: app.route() });
  }
  return handoff.dispatch(action, payloadJson);
};
