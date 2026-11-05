import { describe, expect, test } from "bun:test";
import { type DisplayListScene, type SerializedTap } from "@tenunjs/widgets";
import { completeAction, fieldAction, FOCUS_WORKOUT, REST_DURATION_MS } from "../src/fixtures/workout";
import { createWorkoutRuntime, WORKOUT_VIEWPORT, type WorkoutRuntimeOptions } from "../src/runtime";
import { workoutDarkTheme } from "../src/theme";

type TextInputOp = Extract<DisplayListScene["ops"][number], { op: "text-input" }>;
type RingOp = Extract<DisplayListScene["ops"][number], { op: "ring" }>;

/** Controllable fake clock + captured scheduler for deterministic journeys. */
function fakeClock(): { options: WorkoutRuntimeOptions; advance(ms: number): void; pending(): number } {
  let now = 1_000_000;
  const timers: Array<{ at: number; callback: () => void }> = [];
  return {
    options: {
      now: () => now,
      schedule(callback, delayMs) {
        timers.push({ at: now + Math.max(0, delayMs), callback });
      },
    },
    advance(ms: number) {
      now += ms;
      // Fire every due timer in order, including timers that earlier
      // callbacks scheduled while advancing (the countdown chain).
      let progressed = true;
      while (progressed) {
        progressed = false;
        const due = timers.filter((timer) => timer.at <= now).sort((a, b) => a.at - b.at);
        for (const timer of due) {
          const index = timers.indexOf(timer);
          if (index < 0) continue;
          timers.splice(index, 1);
          now = Math.max(now, timer.at);
          timer.callback();
          progressed = true;
        }
      }
    },
    pending(): number {
      return timers.length;
    },
  };
}

function field(scene: DisplayListScene, id: string): TextInputOp {
  const op = scene.ops.find((op): op is TextInputOp => op.op === "text-input" && op.id === id);
  if (!op) throw new Error(`Missing text field ${id}`);
  return op;
}

function tapById(scene: DisplayListScene, semanticId: string): SerializedTap {
  const node = scene.semantics?.nodes.find((node) => node.id === semanticId);
  const tapId = node?.actions?.find((action) => action.name === "press")?.tapId;
  if (tapId === undefined) throw new Error(`Missing press action for ${semanticId}`);
  return { action: "tap", payload: { id: tapId } } as unknown as SerializedTap;
}

function tapForField(scene: DisplayListScene, id: string): SerializedTap {
  const op = field(scene, id);
  const tap = scene.taps.find((tap) => tap.x === op.x && tap.y === op.y && tap.w === op.w && tap.h === op.h);
  if (!tap) throw new Error(`Missing focus tap for ${id}`);
  return tap;
}

function dispatch(app: ReturnType<typeof createWorkoutRuntime>, tap: SerializedTap): DisplayListScene {
  // ApplicationRuntime.dispatch takes the parsed payload; JSON strings are
  // the host-handoff transport, one layer above this journey composition.
  app.dispatch("TAP", tap.payload);
  return app.render().scene;
}

function editText(app: ReturnType<typeof createWorkoutRuntime>, id: string, text: string): void {
  const scene = app.render().scene;
  const op = field(scene, id);
  app.dispatch("TEXT_EDIT", { id, sessionId: op.sessionId, baseRevision: op.revision,
    text, selection: { base: text.length, extent: text.length }, composing: null });
}

describe("Gate A — Focus workout journey", () => {
  test("renders the fixture with numeric keyboard intent and frozen identifiers", () => {
    const app = createWorkoutRuntime();
    const scene = app.render().scene;
    expect(scene.designWidth).toBe(WORKOUT_VIEWPORT.width);
    const entry = FOCUS_WORKOUT.entries[0]!;
    const weight = field(scene, fieldAction(entry.id, entry.sets[0]!.id, "weight"));
    const reps = field(scene, fieldAction(entry.id, entry.sets[0]!.id, "reps"));
    expect(weight.keyboardType).toBe("decimal");
    expect(reps.keyboardType).toBe("number");
    expect(scene.semantics?.nodes.some((node) => node.id === `workout.entry.${entry.exerciseId}`)).toBe(true);
    expect(scene.semantics?.nodes.some((node) => node.id === completeAction(entry.id, entry.sets[0]!.id))).toBe(true);
    // Alert status node present from the first commit (plan: announce only meaningful changes).
    expect(scene.semantics?.nodes.some((node) => node.role === "alert" && node.liveRegion === true)).toBe(true);
    // Long exercise name (≥40 chars) is present verbatim for label-reflow coverage.
    expect(JSON.stringify(scene)).toContain(FOCUS_WORKOUT.entries[0]!.name);
    // A1 label reflow: at the default wide viewport the long title fits on
    // one line; at a narrow width it wraps into multiple painted lines
    // without overlapping the fields below (the block grows).
    const name = FOCUS_WORKOUT.entries[0]!.name;
    const lineOps = (rendered: DisplayListScene) => rendered.ops.filter((op) => op.op === "text" &&
      typeof (op as { text?: string }).text === "string" &&
      name.includes((op as { text: string }).text) && (op as { text: string }).text.length > 0);
    expect(lineOps(scene).length).toBeGreaterThanOrEqual(1);
    const narrow = createWorkoutRuntime({ width: 320, height: 700 });
    const narrowOps = lineOps(narrow.render().scene);
    expect(narrowOps.length).toBeGreaterThanOrEqual(2);
    expect(narrow.render().scene.semantics?.nodes.some((node) => node.label === name)).toBe(true);
  });

  test("editing weight keeps decimal drafts and commits through the controlled session", () => {
    const clock = fakeClock();
    const app = createWorkoutRuntime(WORKOUT_VIEWPORT, clock.options);
    let scene = app.render().scene;
    const entry = FOCUS_WORKOUT.entries[0]!;
    const weightId = fieldAction(entry.id, entry.sets[0]!.id, "weight");
    scene = dispatch(app, tapForField(scene, weightId));
    expect(field(scene, weightId).focused).toBe(true);
    for (const draft of ["6", "62", "62.", "62.5"]) editText(app, weightId, draft);
    scene = app.render().scene;
    expect(field(scene, weightId)).toMatchObject({ text: "62.5", focused: true });
    expect(JSON.stringify(app.exportState())).toContain('"weightDraft":"62.5"');
    // The committed value parses leniently (comma variant) on the fixture model level.
    editText(app, weightId, "62,5");
    expect(JSON.stringify(app.exportState())).toContain('"weightDraft":"62,5"');
  });

  test("completing a set advances, starts the rest countdown, and paints the ring", () => {
    const clock = fakeClock();
    const app = createWorkoutRuntime(WORKOUT_VIEWPORT, clock.options);
    let scene = app.render().scene;
    const entry = FOCUS_WORKOUT.entries[0]!;
    scene = dispatch(app, tapById(scene, completeAction(entry.id, entry.sets[0]!.id)));
    expect(clock.pending()).toBe(1); // exactly one scheduled foreground tick
    const rings = scene.ops.filter((op): op is RingOp => op.op === "ring" && op.progress >= 0);
    expect(rings.length).toBeGreaterThan(0);
    expect(rings[0]!.progress).toBeCloseTo(1, 1); // full countdown just started
    // Advanced to the next set with its committed drafts.
    expect(field(scene, fieldAction(entry.id, entry.sets[1]!.id, "weight")).text).toBe("62.5");
    // The completed set's editor is gone; the next set's field is unfocused.
    expect(scene.ops.some((op) => op.op === "text-input" &&
      (op as TextInputOp).id === fieldAction(entry.id, entry.sets[0]!.id, "weight"))).toBe(false);
    expect(field(scene, fieldAction(entry.id, entry.sets[1]!.id, "weight")).focused).toBe(false);
  });

  test("countdown ticks repaint the ring from the deadline; a late tick completes without drift", () => {
    const clock = fakeClock();
    const app = createWorkoutRuntime(WORKOUT_VIEWPORT, clock.options);
    let scene = dispatch(app,
      tapById(app.render().scene, completeAction(FOCUS_WORKOUT.entries[0]!.id, FOCUS_WORKOUT.entries[0]!.sets[0]!.id)));
    clock.advance(30_000);
    scene = app.render().scene;
    const rings = scene.ops.filter((op): op is RingOp => op.op === "ring" && op.progress >= 0);
    expect(rings[0]!.progress).toBeCloseTo(60_000 / REST_DURATION_MS, 1);
    // Late callback: 91s after start (1s past the deadline) → completes once, remaining 0.
    clock.advance(61_000);
    scene = app.render().scene;
    const state = app.exportState().states["focus"] as Record<string, unknown>;
    expect(state.restPhase).toBe("idle");
    expect(state.restRemainingMs).toBe(0);
    expect(state.restRound).toBe(1);
    // The alert text changed exactly once — announce-worthy state change, not per-second chatter.
    const alert = scene.semantics?.nodes.find((node) => node.role === "alert");
    expect(alert?.label).toBe("Rest complete — next set is ready");
  });

  test("pause freezes the countdown, resume continues it, and skip ends it visibly", () => {
    const clock = fakeClock();
    const app = createWorkoutRuntime(WORKOUT_VIEWPORT, clock.options);
    let scene = dispatch(app,
      tapById(app.render().scene, completeAction(FOCUS_WORKOUT.entries[0]!.id, FOCUS_WORKOUT.entries[0]!.sets[0]!.id)));
    clock.advance(10_000);
    scene = dispatch(app, tapById(scene, "rest.pause"));
    let state = app.exportState().states["focus"] as Record<string, unknown>;
    expect(state.restPhase).toBe("paused");
    const frozen = (scene.ops.filter((op): op is RingOp => op.op === "ring")[0]!).progress;
    clock.advance(20_000);
    expect((app.render().scene.ops.filter((op): op is RingOp => op.op === "ring")[0]!).progress).toBeCloseTo(frozen, 5);
    scene = dispatch(app, tapById(scene, "rest.resume"));
    state = app.exportState().states["focus"] as Record<string, unknown>;
    expect(state.restPhase).toBe("running");
    clock.advance(REST_DURATION_MS);
    expect((app.exportState().states["focus"] as Record<string, unknown>).restPhase).toBe("idle");
    // Skip path on a fresh countdown.
    scene = dispatch(app, tapById(app.render().scene,
      completeAction(FOCUS_WORKOUT.entries[0]!.id, FOCUS_WORKOUT.entries[0]!.sets[1]!.id)));
    scene = dispatch(app, tapById(scene, "rest.skip"));
    expect((app.exportState().states["focus"] as Record<string, unknown>).restPhase).toBe("idle");
    expect(app.render().scene.semantics?.nodes.some((node) => node.role === "alert" &&
      node.label === "Rest complete — next set is ready")).toBe(true);
  });

  test("invalid drafts fail visibly without advancing or duplicating a completion", () => {
    const clock = fakeClock();
    const app = createWorkoutRuntime(WORKOUT_VIEWPORT, clock.options);
    const entry = FOCUS_WORKOUT.entries[0]!;
    const weightId = fieldAction(entry.id, entry.sets[0]!.id, "weight");
    let scene = dispatch(app, tapForField(app.render().scene, weightId));
    editText(app, weightId, "62.5");
    // Framework gate: letters cannot land in a decimal field at all.
    expect(() => editText(app, weightId, "heavy")).toThrow("INVALID_TEXT_CONTENT");
    expect(JSON.parse(JSON.stringify(app.render().scene.ops.find((op) => op.op === "text-input" &&
      (op as TextInputOp).id === weightId))).text).toBe("62.5");
    // Empty draft is a legal intermediate; completing with it fails visibly.
    editText(app, weightId, "");
    scene = dispatch(app, tapById(app.render().scene, completeAction(entry.id, entry.sets[0]!.id)));
    const state = app.exportState().states["focus"] as Record<string, unknown>;
    expect(state?.weightError).toBe("Enter a weight like 62.5");
    expect(state.completedSets).toEqual([]);
    expect(clock.pending()).toBe(0); // no countdown was started
    expect(scene.semantics?.nodes.some((node) => node.role === "alert" && node.label === "Ready")).toBe(true);
  });

  test("theme swap and 2x text scale re-render the journey without losing state", () => {
    const clock = fakeClock();
    const app = createWorkoutRuntime(WORKOUT_VIEWPORT, clock.options);
    dispatch(app, tapById(app.render().scene,
      completeAction(FOCUS_WORKOUT.entries[0]!.id, FOCUS_WORKOUT.entries[0]!.sets[0]!.id)));
    const before = JSON.stringify(app.exportState());
    // TN-170: theme swaps ride the runtime invalidation channel, not screen state.
    app.setTheme(workoutDarkTheme);
    app.setEnvironment({ textScale: 2 });
    const scene = app.render().scene;
    expect(scene.designWidth).toBe(WORKOUT_VIEWPORT.width);
    expect(JSON.stringify(app.exportState())).toBe(before); // scale + theme changes never mutate state
    expect(field(scene, fieldAction(FOCUS_WORKOUT.entries[0]!.id, FOCUS_WORKOUT.entries[0]!.sets[1]!.id, "weight")).text)
      .toBe("62.5");
  });
});

describe("Gate A — focus transfer (slice C)", () => {
  test("IME Next chains weight → reps and Done on reps ends the session", () => {
    const clock = fakeClock();
    const app = createWorkoutRuntime(WORKOUT_VIEWPORT, clock.options);
    const entry = FOCUS_WORKOUT.entries[0]!;
    const weightId = fieldAction(entry.id, entry.sets[0]!.id, "weight");
    const repsId = fieldAction(entry.id, entry.sets[0]!.id, "reps");
    let scene = dispatch(app, tapForField(app.render().scene, weightId));
    const active = field(scene, weightId);
    expect(active.returnAction).toBe("next");
    app.dispatch("TEXT_SUBMIT", { id: active.id, sessionId: active.sessionId, baseRevision: active.revision });
    scene = app.render().scene;
    const next = field(scene, repsId);
    expect(next.focused).toBe(true);
    expect(next.sessionId).toBeGreaterThan(active.sessionId);
    expect(next.returnAction).toBe("done");
    // Done on reps: session ends, no accidental duplicate field activation.
    app.dispatch("TEXT_SUBMIT", { id: next.id, sessionId: next.sessionId, baseRevision: next.revision });
    expect(field(app.render().scene, repsId).focused).toBe(false);
  });
});

describe("review fixes — duplicate delivery and timer ownership", () => {
  test("replaying the completion tap does not complete the next set", () => {
    const clock = fakeClock();
    const app = createWorkoutRuntime(WORKOUT_VIEWPORT, clock.options);
    const scene = app.render().scene;
    const entry = FOCUS_WORKOUT.entries[0]!;
    const tapId = scene.semantics?.nodes.find((node) => node.id === completeAction(entry.id, entry.sets[0]!.id))
      ?.actions?.[0]?.tapId;
    expect(tapId).toBeDefined();
    app.dispatch("TAP", { id: tapId! });
    const state = () => app.exportState().states["focus"] as Record<string, unknown>;
    expect(state().completedSets).toEqual(["set-1-1"]);
    expect(state().results).toEqual({ "set-1-1": { weight: "60", reps: "8" } });
    // The replacement button reuses the same numeric tap id: a duplicated
    // delivery of the ORIGINAL payload is a stale press and is ignored.
    app.dispatch("TAP", { id: tapId! });
    expect(state().completedSets).toEqual(["set-1-1"]);
    // And the committed result row paints what the user entered (set rows
    // live nested inside the workout-sets scroll region's own op list).
    const region = app.render().scene.ops.find((op) => op.op === "scroll-region") as
      { ops?: Array<{ op: string; text?: string }> } | undefined;
    const done = (region?.ops ?? []).filter((op) => op.op === "text" &&
      typeof op.text === "string" && op.text.startsWith("Done —"));
    expect(done.map((op) => op.text)).toEqual(["Done — 60 kg × 8"]);
  });

  test("pause/resume cycles never multiply live countdown chains, and disposal stays inert", () => {
    const clock = fakeClock();
    const app = createWorkoutRuntime(WORKOUT_VIEWPORT, clock.options);
    dispatch(app, tapById(app.render().scene,
      completeAction(FOCUS_WORKOUT.entries[0]!.id, FOCUS_WORKOUT.entries[0]!.sets[0]!.id)));
    // Five pause/resume cycles each schedule through the owned generation
    // token: earlier callbacks become inert instead of stacking chains.
    for (let index = 0; index < 5; index++) {
      dispatch(app, tapById(app.render().scene, "rest.pause"));
      dispatch(app, tapById(app.render().scene, "rest.resume"));
    }
    const before = clock.pending();
    expect(before).toBeGreaterThan(0);
    // The countdown still completes exactly once through the newest chain.
    clock.advance(REST_DURATION_MS * 2);
    const state = app.exportState().states["focus"] as Record<string, unknown>;
    expect(state.restPhase).toBe("idle");
    expect(state.restRound).toBe(1);
    // A callback firing after disposal is inert: no RUNTIME_DISPOSED throw.
    app.dispose();
    expect(() => clock.advance(1)).not.toThrow();
  });
});
