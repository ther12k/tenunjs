import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { buildWorkoutBundleCode } from "../scripts/build-host";

/**
 * Host-boot tests: drive the REAL entry module / BUILT bundle exactly like
 * the Android engine does — JSON-string dispatches through
 * `__tenun_dispatch_action`, headless scene capture in `__tenun_last_scene`,
 * and the host scheduler's TIMER re-entry draining the entry's timer shim.
 * The bun-tier stand-in for the QuickJS path; an installed-device journey
 * remains the acceptance gate.
 */

const host = globalThis as Record<string, unknown>;

interface Booted {
  dispatch(action: string, payloadJson: string): string;
  lastScene(): string | null;
}

interface Scene {
  tenun: string;
  designWidth: number;
  contentHeight: number;
  ops: Array<{ op: string; text?: string; progress?: number; id?: string; keyboardType?: string }>;
  taps: Array<{ x: number; y: number; w: number; h: number; payload: { id: number } }>;
  semantics?: { nodes: Array<{ id?: string; role?: string; label?: string; liveRegion?: boolean;
    actions?: Array<{ name: string; tapId: number }> }> };
}

function sceneOf(entry: Booted): Scene {
  const raw = entry.lastScene();
  if (!raw) throw new Error("No committed scene");
  return JSON.parse(raw) as Scene;
}

function tapRegion(scene: Scene, x: number, y: number, w: number, h: number): { id: number } {
  const tap = scene.taps.find((tap) => tap.x === x && tap.y === y && tap.w === w && tap.h === h);
  if (!tap) throw new Error("Missing tap for region");
  return tap.payload;
}

function pressSemantic(entry: Booted, current: Scene, semanticId: string): Scene {
  // The host fires the press action's tapId (same table TAP dispatch uses).
  const node = current.semantics?.nodes.find((node) => node.id === semanticId);
  const tapId = node?.actions?.find((action) => action.name === "press")?.tapId;
  if (tapId === undefined) throw new Error(`Missing press action for ${semanticId}`);
  entry.dispatch("TAP", JSON.stringify({ id: tapId }));
  return sceneOf(entry);
}

const WEIGHT_ID = "workout.set.entry-1.set-1-1.field.weight";

/** Focus weight, edit it, complete the set — the shared journey prologue. */
function completeFirstSet(entry: Booted): Scene {
  let current = sceneOf(entry);
  const weight = current.ops.find((op) => op.op === "text-input" && op.id === WEIGHT_ID) as
    { x: number; y: number; w: number; h: number } | undefined;
  if (!weight) throw new Error("Missing weight field");
  entry.dispatch("TAP", JSON.stringify(tapRegion(current, weight.x, weight.y, weight.w, weight.h)));
  const focused = sceneOf(entry).ops.find((op) => op.op === "text-input" && op.id === WEIGHT_ID) as unknown as
    { focused: boolean; sessionId: number; revision: number };
  if (!focused.focused) throw new Error("Weight field did not take focus");
  entry.dispatch("TEXT_EDIT", JSON.stringify({ id: WEIGHT_ID, sessionId: focused.sessionId,
    baseRevision: focused.revision, text: "62.5", selection: { base: 4, extent: 4 }, composing: null }));
  return pressSemantic(entry, sceneOf(entry), "workout.set.entry-1.set-1-1.complete");
}

describe("workout host entry boots through the production contract", () => {
  test("initial scene carries the numeric fields and frozen identifiers", async () => {
    delete host.tenun_commit; // headless: scenes land in __tenun_last_scene
    await import("../src/host-entry");
    const entry: Booted = { dispatch: host["__tenun_dispatch_action"] as Booted["dispatch"],
      lastScene: () => host["__tenun_last_scene"] as string | null };
    const current = sceneOf(entry);
    expect(current.tenun).toBe("display-list");
    expect(current.ops.find((op) => op.op === "text-input" && op.id === WEIGHT_ID)?.keyboardType).toBe("decimal");
    expect(current.semantics?.nodes.some((node) => node.id === "workout.entry.ex-bench")).toBe(true);
  });

  test("bun-global timer path: completing a set paints the ring and the ~1s tick repaints it", async () => {
    const entry: Booted = { dispatch: host["__tenun_dispatch_action"] as Booted["dispatch"],
      lastScene: () => host["__tenun_last_scene"] as string | null };
    const after = completeFirstSet(entry);
    expect(after.ops.filter((op) => op.op === "ring").length).toBeGreaterThan(0);
    expect(after.semantics?.nodes.some((node) => node.role === "alert")).toBe(true);
    // The runtime's default scheduler is the bun global here: the first ~1s
    // tick fires on its own; the TIMER re-entry drains whatever is due.
    await Bun.sleep(1100);
    entry.dispatch("TIMER", "{}");
    const ticked = sceneOf(entry);
    const ring = ticked.ops.find((op) => op.op === "ring") as { progress: number } | undefined;
    expect(ring).toBeDefined();
    expect(ring!.progress).toBeLessThan(1); // countdown visibly advanced
  });

  test("QuickJS shim path (no timer globals): scheduleTimer is requested and TIMER drains the tick", async () => {
    const code = await buildWorkoutBundleCode();
    const committed: string[] = [];
    const scheduleCalls: string[] = [];
    const context: Record<string, unknown> = {
      tenun_commit: (json: string) => { committed.push(json); },
      // QuickJS host bridge: the shim's only channel for asking the native
      // scheduler to re-enter the dispatch entry.
      tenun_host_call: (svc: string, method: string, payload: string): string | null => {
        if (svc === "system" && method === "scheduleTimer") scheduleCalls.push(payload);
        return "true";
      },
    };
    runInNewContext(code, context, { filename: "workout-app.js", timeout: 5000 });
    const dispatch = context["__tenun_dispatch_action"] as Booted["dispatch"];
    const entry: Booted = { dispatch, lastScene: () => committed.at(-1) ?? null };
    expect(sceneOf(entry).ops.some((op) => op.op === "text-input")).toBe(true);
    const after = completeFirstSet(entry);
    expect(after.ops.filter((op) => op.op === "ring").length).toBeGreaterThan(0);
    expect(scheduleCalls.length).toBeGreaterThanOrEqual(1);
    // After one real second, the host's TIMER re-entry drains the due tick.
    await Bun.sleep(1100);
    dispatch("TIMER", "{}");
    const ring = (JSON.parse(committed.at(-1)!) as Scene).ops.find((op) => op.op === "ring") as { progress: number };
    expect(ring.progress).toBeLessThan(1);
  });

  test("built bundle debounces duplicate completion tap and bounds native timer requests", async () => {
    const code = await buildWorkoutBundleCode();
    let lastSceneJson = "";
    const scheduleCalls: number[] = [];
    const context: Record<string, unknown> = {
      tenun_commit: (json: string) => { lastSceneJson = json; },
      tenun_host_call: (svc: string, method: string, payload: string): string | null => {
        if (svc === "system" && method === "scheduleTimer") {
          scheduleCalls.push(JSON.parse(payload).delayMs);
        }
        return "true";
      },
    };
    runInNewContext(code, context, { filename: "workout-app.js", timeout: 5000 });
    const dispatch = context["__tenun_dispatch_action"] as Booted["dispatch"];
    const entry: Booted = { dispatch, lastScene: () => lastSceneJson };

    // Complete first set:
    completeFirstSet(entry);
    const state = () => JSON.parse(dispatch("__TENUN_EXPORT", "{}")).states.focus;
    expect(state().completedSets).toEqual(["set-1-1"]);

    // Rapid duplicate tap delivery with the SAME tap id before moving on:
    const completeNode = (JSON.parse(lastSceneJson) as Scene).semantics?.nodes
      ?.find((n) => n.id?.endsWith(".complete"));
    const tapId = completeNode?.actions?.[0]?.tapId;
    expect(tapId).toBeDefined();
    dispatch("TAP", JSON.stringify({ id: tapId }));
    // Cooldown debounces rapid duplicate tap; next set is NOT completed:
    expect(state().completedSets).toEqual(["set-1-1"]);

    // Timer calls: initially exactly 1 timer is scheduled.
    const initialCallCount = scheduleCalls.length;
    expect(initialCallCount).toBeGreaterThanOrEqual(1);

    // Simulated 3 seconds of TIMER re-entry: call count only increases linearly, not exponentially.
    dispatch("TIMER", "{}");
    dispatch("TIMER", "{}");
    dispatch("TIMER", "{}");
    // Growth is strictly bounded (no unbounded runaway re-arm calls):
    expect(scheduleCalls.length).toBeLessThanOrEqual(initialCallCount + 3);

    // Non-timer dispatch arriving after deadline does not accumulate duplicate wakeups:
    const countBeforeOverdueInput = scheduleCalls.length;
    dispatch("TAP", JSON.stringify({ id: tapId }));
    expect(scheduleCalls.length).toBe(countBeforeOverdueInput);
  });

  test("cross-engine TENUN_RESTORE rebases countdown timestamps to new performance origin", async () => {
    const code = await buildWorkoutBundleCode();
    let oldClock = 600_000;
    let oldScene: string | null = null;
    const oldContext: Record<string, unknown> = {
      performance: { now: () => oldClock },
      tenun_commit: (json: string) => { oldScene = json; },
      tenun_host_call: () => "true",
    };
    runInNewContext(code, oldContext, { filename: "workout-app.js", timeout: 5000 });
    const oldDispatch = oldContext["__tenun_dispatch_action"] as Booted["dispatch"];
    const oldEntry: Booted = { dispatch: oldDispatch, lastScene: () => oldScene };
    completeFirstSet(oldEntry);
    const snapshot = oldDispatch("__TENUN_EXPORT", "{}");
    expect(JSON.parse(snapshot).states.focus.completedSets).toEqual(["set-1-1"]);

    // Boot a fresh engine starting at monotonic origin 100
    let freshClock = 100;
    let freshScene: string | null = null;
    const freshContext: Record<string, unknown> = {
      performance: { now: () => freshClock },
      tenun_commit: (json: string) => { freshScene = json; },
      tenun_host_call: () => "true",
    };
    runInNewContext(code, freshContext, { filename: "workout-app.js", timeout: 5000 });
    const freshDispatch = freshContext["__tenun_dispatch_action"] as Booted["dispatch"];
    freshDispatch("TENUN_RESTORE", snapshot);

    const restoredState = JSON.parse(freshDispatch("__TENUN_EXPORT", "{}")).states.focus;
    expect(restoredState.restRemainingMs).toBe(90_000);
    expect(restoredState.restDeadline).toBe(100 + 90_000);
    expect(restoredState.lastCompletedAt).toBeNull();

    // 30 seconds later, completing the next set legitimately succeeds:
    freshClock += 30_000;
    const completeNode = (JSON.parse(freshScene!) as Scene).semantics?.nodes?.find((n) => n.id?.endsWith(".complete"));
    expect(completeNode?.actions?.[0]?.tapId).toBeDefined();
    freshDispatch("TAP", JSON.stringify({ id: completeNode!.actions![0]!.tapId }));
    const afterSecondSet = JSON.parse(freshDispatch("__TENUN_EXPORT", "{}")).states.focus;
    expect(afterSecondSet.completedSets).toEqual(["set-1-1", "set-1-2"]);
  });
});
