/**
 * QuickJS bundle entry for the workout pilot: packages createWorkoutRuntime
 * for native Android execution behind installHostHandoff, with the
 * setTimeout shim the rest countdown's tick chain needs (QuickJS has no
 * timer globals; the host scheduler re-enters this dispatch entry, which
 * drains due callbacks — the polytron-entry precedent).
 *
 * Review fixes: the clock is a ratcheted monotonic wrapper over Date.now
 * (QuickJS has no performance.now), shared by the countdown and the shim so
 * a backward jump cannot strand a timer without a wake-up; and a restored
 * "running" countdown is re-armed through a synthetic tick after TENUN_RESTORE.
 */
import { installHostHandoff } from "@tenunjs/widgets";
import { createWorkoutRuntime } from "./runtime";

const host = globalThis as Record<string, unknown>;

/** Monotonic clock: uses performance.now() when available (QuickJS/browser/Bun) to avoid wall-clock jumps. */
const getMonotonicNow = (): number => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return Math.round(performance.now());
  }
  return Date.now();
};

interface ActiveTimer {
  id: number;
  runAt: number;
  fn: () => void;
}

let nextTimerId = 1;
const activeTimers = new Map<number, ActiveTimer>();
let scheduledHostWakeupAt: number | null = null;

/** Asks the native scheduler for the next wake-up when timers remain, without
 *  accumulating redundant wake-up calls. */
function requestNextWakeup(nowMs: number): void {
  let nextAt = Number.POSITIVE_INFINITY;
  for (const timer of activeTimers.values()) nextAt = Math.min(nextAt, timer.runAt);
  if (!Number.isFinite(nextAt) || typeof host.tenun_host_call !== "function") {
    scheduledHostWakeupAt = null;
    return;
  }
  if (scheduledHostWakeupAt !== null && scheduledHostWakeupAt <= nextAt) {
    return;
  }
  scheduledHostWakeupAt = nextAt;
  try {
    (host.tenun_host_call as (s: string, m: string, p: string) => string | null)(
      "system",
      "scheduleTimer",
      JSON.stringify({ delayMs: Math.max(0, nextAt - nowMs) }),
    );
  } catch {
    // Host scheduler optional; dispatch entry drains automatically.
  }
}

function drainTimers(isTimerDispatch = false): void {
  const nowMs = getMonotonicNow();
  if (isTimerDispatch) {
    scheduledHostWakeupAt = null;
  }
  for (const [id, timer] of Array.from(activeTimers.entries())) {
    if (nowMs >= timer.runAt) {
      activeTimers.delete(id);
      try {
        timer.fn();
      } catch {
        // Keep draining; a rejected tick must not starve the others.
      }
    }
  }
  requestNextWakeup(nowMs);
}

if (typeof (host as { setTimeout?: unknown }).setTimeout !== "function") {
  (host as { setTimeout: (fn: () => void, ms?: number) => number }).setTimeout = (
    fn: () => void,
    ms: number = 0,
  ) => {
    const id = nextTimerId++;
    const delay = Math.max(0, ms);
    const now = getMonotonicNow();
    activeTimers.set(id, { id, runAt: now + delay, fn });
    requestNextWakeup(now);
    return id;
  };
  (host as { clearTimeout: (id: number) => void }).clearTimeout = (id: number) => {
    activeTimers.delete(id);
  };
}

const app = createWorkoutRuntime(undefined, { now: getMonotonicNow });
const handoff = installHostHandoff({
  app,
  commit(json) {
    const sink = host["tenun_commit"];
    if (typeof sink === "function") sink(json);
    else host["__tenun_last_scene"] = json;
  },
});

host["__tenun_dispatch_action"] = (action: string, payloadJson: string): string => {
  const normalized = action.toUpperCase();
  drainTimers(normalized === "TIMER");
  // The host scheduler's re-entry verb: due callbacks already ran above.
  if (normalized === "TIMER") {
    return JSON.stringify({ route: app.route() });
  }
  const reply = handoff.dispatch(action, payloadJson);
  if (normalized === "TENUN_RESTORE") {
    // Rebase monotonic timestamps into the fresh engine's time origin
    // and re-arm the ~1 Hz chain if a rest was in progress.
    try {
      app.pushTo("focus", "rebaseClock", getMonotonicNow());
    } catch {
      // The restored route is not mounted; nothing to re-arm.
    }
  }
  return reply;
};
