import { describe, expect, test } from "bun:test";
import { mountScreen } from "@tenunjs-examples/test-support";
import {
  clamp, FOCUS_WORKOUT, formatReps, formatWeight, parseDecimalDraft,
  REPS_MAX, REPS_MIN, WEIGHT_MAX, WEIGHT_MIN,
} from "../src/fixtures/workout";
import { FocusScreen, initialFocusState } from "../src/screens/focus.screen";

function restServices(now: number) {
  const ticks: number[] = [];
  return { services: { now: () => now, scheduleRestTick: (delayMs: number) => ticks.push(delayMs) }, ticks };
}

describe("Focus workout named actions", () => {
  test("initial state derives canonical drafts from the fixture's first set", () => {
    const state = initialFocusState();
    const set = FOCUS_WORKOUT.entries[0]!.sets[0]!;
    expect(state.weightDraft).toBe(formatWeight(set.weight));
    expect(state.repsDraft).toBe(formatReps(set.reps));
    expect(state.restPhase).toBe("idle");
    expect(state.workoutComplete).toBe(false);
  });

  test("steppers step from the draft and clamp to the documented ranges", async () => {
    const { services } = restServices(1_000);
    const screen = mountScreen(FocusScreen, { services });
    await screen.press("stepWeight", "up");
    expect(screen.state.weightDraft).toBe("62.5");
    await screen.press("stepWeight", "down");
    await screen.press("stepWeight", "down");
    expect(screen.state.weightDraft).toBe("57.5");
    await screen.press("stepReps", "up");
    expect(screen.state.repsDraft).toBe("9");
    await screen.press("stepReps", "down");
    await screen.press("stepReps", "down");
    expect(screen.state.repsDraft).toBe("7");
    expect(clamp(-5, WEIGHT_MIN, WEIGHT_MAX)).toBe(WEIGHT_MIN);
    expect(clamp(WEIGHT_MAX + 5, WEIGHT_MIN, WEIGHT_MAX)).toBe(WEIGHT_MAX);
    expect(clamp(-1, REPS_MIN, REPS_MAX)).toBe(REPS_MIN);
    expect(clamp(REPS_MAX + 1, REPS_MIN, REPS_MAX)).toBe(REPS_MAX);
    await expect(screen.press("stepWeight", "sideways")).rejects.toThrow("up or down");
  });

  test("completion requires valid drafts and advances through every set to workout-complete", async () => {
    let now = 1_000;
    const ticks: number[] = [];
    const screen = mountScreen(FocusScreen, {
      services: { now: () => now, scheduleRestTick: (delayMs: number) => ticks.push(delayMs) },
    });
    await screen.press("completeSet");
    expect(screen.state.completedSets).toEqual(["set-1-1"]);
    expect(screen.state.restPhase).toBe("running");
    expect(screen.state.restDeadline).toBe(now + 90_000);
    expect(ticks).toEqual([1000]); // first tick at ~1 Hz, not the full duration
    // Drafts now reflect the next set's committed values.
    expect(screen.state.weightDraft).toBe(formatWeight(FOCUS_WORKOUT.entries[0]!.sets[1]!.weight));
    // A skipped rest still advances the round and clears the countdown.
    await screen.press("restSkip");
    expect(screen.state.restPhase).toBe("idle");
    expect(screen.state.restRound).toBe(1);
    // Drive through the remaining sets; entry 2 follows entry 1.
    const totalSets = FOCUS_WORKOUT.entries.reduce((sum, entry) => sum + entry.sets.length, 0);
    for (let index = 1; index < totalSets; index++) {
      now += 60_000;
      await screen.press("completeSet");
    }
    expect(screen.state.workoutComplete).toBe(true);
    expect(screen.state.completedSets).toEqual(
      FOCUS_WORKOUT.entries.flatMap((entry) => entry.sets.map((set) => set.id)));
    // Completion is idempotent once the workout is done.
    await screen.press("completeSet");
    expect(screen.state.completedSets).toHaveLength(totalSets);
    expect(screen.render()).not.toBeNull();
  });

  test("invalid drafts fail visibly per field without advancing or scheduling a countdown", async () => {
    const { services, ticks } = restServices(5_000);
    const screen = mountScreen(FocusScreen, { services });
    await screen.press("editWeight", "");
    await screen.press("completeSet");
    expect(screen.state.weightError).toBe("Enter a weight like 62.5");
    expect(screen.state.completedSets).toEqual([]);
    expect(ticks).toEqual([]);
    await screen.press("editWeight", "62.5");
    await screen.press("editReps", "8.5");
    await screen.press("completeSet");
    expect(screen.state.repsError).toBe("Enter whole reps like 8");
    expect(screen.state.completedSets).toEqual([]);
    expect(screen.state.weightError).toBeNull();
    // Rejects non-string drafts loudly (fail-closed fixture contract).
    await expect(screen.press("editWeight", 62)).rejects.toThrow("strings");
    expect(screen.render()).not.toBeNull();
  });

  test("rest ticks recompute from the deadline and ignore stale phases", async () => {
    const { services, ticks } = restServices(10_000);
    const screen = mountScreen(FocusScreen, { services });
    await screen.press("completeSet");
    // A tick before the deadline repaints the remaining value.
    await screen.press("restTick", 10_000 + 30_000);
    expect(screen.state.restRemainingMs).toBe(60_000);
    expect(screen.state.restPhase).toBe("running");
    // Pause freezes: ticks are ignored, nothing reschedules.
    await screen.press("restPause");
    await screen.press("restTick", 10_000 + 40_000);
    expect(screen.state.restRemainingMs).toBe(60_000);
    // Resume recomputes the deadline from the injected now and restarts the chain.
    await screen.press("restResume");
    expect(screen.state.restPhase).toBe("running");
    expect(ticks.at(-1)).toBe(1000);
    // A late completion tick lands past the deadline: completes once, remaining 0.
    await screen.press("restTick", 10_000 + 30_000 + 90_000);
    expect(screen.state.restPhase).toBe("idle");
    expect(screen.state.restRemainingMs).toBe(0);
    expect(screen.state.restRound).toBe(1);
    // Ticks in idle are stale no-ops (round never moves).
    await screen.press("restTick", 10_000 + 200_000);
    expect(screen.state.restRound).toBe(1);
    await expect(screen.press("restTick", -1)).rejects.toThrow("monotonic");
    expect(screen.render()).not.toBeNull();
  });
});

describe("fixture model", () => {
  test("lenient decimal parsing commits complete numbers only", () => {
    expect(parseDecimalDraft("62.5")).toBe(62.5);
    expect(parseDecimalDraft("62,5")).toBe(62.5);
    expect(parseDecimalDraft(" 60 ")).toBe(60);
    for (const draft of ["", "-", "62.", "12,5,5", "abc", "1 2"]) {
      expect(parseDecimalDraft(draft)).toBeNull();
    }
  });
});
