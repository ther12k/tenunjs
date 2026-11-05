import { defineScreen, type ScreenActionContext } from "@tenunjs/core";
import { AppBar, Button, Card, Column, Expanded, Row, Scaffold, ScrollView, Text, TextField } from "@tenunjs/widgets";
import { colorSlot } from "@tenunjs/widgets";
import { ProgressRing } from "@tenunjs-examples/ui-kit";
import {
  clamp, completeAction, fieldAction, FOCUS_WORKOUT, formatClock, formatReps, formatWeight,
  parseDecimalDraft, REST_DURATION_MS, REPS_MAX, REPS_MIN, REPS_STEP, statusSemantics,
  stepAction, WEIGHT_MAX, WEIGHT_MIN, WEIGHT_STEP_KG,
} from "../fixtures/workout";

/**
 * Journey 1 — Focus workout (docs/fixture-journeys.md). Ordinary TSX over
 * public widgets: the framework never sees workout state or business logic.
 * The countdown derives remaining time from a deadline plus the runtime's
 * injected monotonic clock, so a late tick cannot accumulate drift; ticks
 * arrive through ApplicationRuntime.pushTo and repaint the host-painted ring.
 */

export type RestPhase = "idle" | "running" | "paused";

export interface FocusState {
  entryIndex: number;
  setIndex: number;
  weightDraft: string;
  repsDraft: string;
  weightError: string | null;
  repsError: string | null;
  completedSets: string[];
  /** Committed weight/reps per completed set id — what the user entered, not fixture defaults. */
  results: Record<string, { weight: string; reps: string }>;
  restPhase: RestPhase;
  restDeadline: number | null;
  restRemainingMs: number;
  /** Increments on every rest completion; the alert text change announces once. */
  restRound: number;
  workoutComplete: boolean;
  /** Cooldown timestamp to prevent duplicate completion replays. */
  lastCompletedAt: number | null;
}

function initialDrafts(entryIndex = 0, setIndex = 0): { weightDraft: string; repsDraft: string } {
  const set = FOCUS_WORKOUT.entries[entryIndex]!.sets[setIndex]!;
  return { weightDraft: formatWeight(set.weight), repsDraft: formatReps(set.reps) };
}

export function initialFocusState(): FocusState {
  return {
    entryIndex: 0, setIndex: 0, ...initialDrafts(),
    weightError: null, repsError: null, completedSets: [], results: {},
    restPhase: "idle", restDeadline: null, restRemainingMs: REST_DURATION_MS, restRound: 0,
    workoutComplete: false,
    lastCompletedAt: null,
  };
}

interface WorkoutServices {
  /** Injected monotonic clock (ms); never Date.now inside actions. */
  now(): number;
  /** Foreground scheduler; the runtime injects the push channel. */
  scheduleRestTick(delayMs: number): void;
}

function workoutServices(context: ScreenActionContext<FocusState>): WorkoutServices {
  const record = context.services as Partial<WorkoutServices> | undefined;
  if (typeof record?.now !== "function" || typeof record?.scheduleRestTick !== "function") {
    throw new TypeError("Focus workout requires now() and scheduleRestTick() services");
  }
  return record as WorkoutServices;
}

function checkedDraft(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Field drafts must be strings");
  return value;
}

function checkedDirection(value: unknown): "up" | "down" {
  if (value !== "up" && value !== "down") throw new TypeError("Stepper direction must be up or down");
  return value;
}

function checkedNow(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError("Rest ticks carry a finite monotonic now in milliseconds");
  }
  return value;
}

/** The active set after completed-set advancement, or null when the workout is done. */
export function activeSet(state: FocusState): { entryIndex: number; setIndex: number; setId: string } | null {
  for (let entry = state.entryIndex; entry < FOCUS_WORKOUT.entries.length; entry++) {
    const sets = FOCUS_WORKOUT.entries[entry]!.sets;
    for (let index = entry === state.entryIndex ? state.setIndex : 0; index < sets.length; index++) {
      if (!state.completedSets.includes(sets[index]!.id)) {
        return { entryIndex: entry, setIndex: index, setId: sets[index]!.id };
      }
    }
  }
  return null;
}

function advanceFrom(state: FocusState): Pick<FocusState, "entryIndex" | "setIndex" | "weightDraft" | "repsDraft" | "workoutComplete"> {
  const candidate: FocusState = { ...state, completedSets: [...state.completedSets] };
  const next = activeSet(candidate);
  if (next === null) {
    return { entryIndex: state.entryIndex, setIndex: state.setIndex,
      ...initialDrafts(state.entryIndex, state.setIndex), workoutComplete: true };
  }
  return { entryIndex: next.entryIndex, setIndex: next.setIndex,
    ...initialDrafts(next.entryIndex, next.setIndex), workoutComplete: false };
}

export const FocusScreen = defineScreen({
  name: "Focus",
  initialState: initialFocusState,
  actions: {
    editWeight({ state, input }: ScreenActionContext<FocusState>) {
      state.weightDraft = checkedDraft(input);
    },
    editReps({ state, input }: ScreenActionContext<FocusState>) {
      state.repsDraft = checkedDraft(input);
    },
    stepWeight({ state, input }: ScreenActionContext<FocusState>) {
      const direction = checkedDirection(input);
      const base = parseDecimalDraft(state.weightDraft) ??
        FOCUS_WORKOUT.entries[state.entryIndex]!.sets[state.setIndex]!.weight;
      state.weightDraft = formatWeight(
        clamp(base + (direction === "up" ? WEIGHT_STEP_KG : -WEIGHT_STEP_KG), WEIGHT_MIN, WEIGHT_MAX),
      );
      state.weightError = null;
    },
    stepReps({ state, input }: ScreenActionContext<FocusState>) {
      const direction = checkedDirection(input);
      const base = parseDecimalDraft(state.repsDraft) ??
        FOCUS_WORKOUT.entries[state.entryIndex]!.sets[state.setIndex]!.reps;
      state.repsDraft = formatReps(
        clamp(base + (direction === "up" ? REPS_STEP : -REPS_STEP), REPS_MIN, REPS_MAX),
      );
      state.repsError = null;
    },
    completeSet(context: ScreenActionContext<FocusState>) {
      const { state, input } = context;
      // Stale-tap guard (review P2): the rendered button carries the set id
      // it was rendered for. A duplicate delivery of an already-handled press
      // (the tap id is reused by the next set's button) targets a different
      // active set and is ignored — one press completes exactly one set.
      // Direct invocation without an id (tests, keyboard shortcuts) skips
      // the identity check; the production transport always carries one.
      const expectedSetId = input === undefined ? undefined : checkedDraft(input);
      // One complete transaction per press: parse first, fail visibly, never
      // advance or duplicate a completion on invalid drafts.
      const weight = parseDecimalDraft(state.weightDraft);
      if (weight === null || weight < WEIGHT_MIN || weight > WEIGHT_MAX) {
        state.weightError = "Enter a weight like 62.5";
        return;
      }
      state.weightError = null;
      const reps = parseDecimalDraft(state.repsDraft);
      if (reps === null || reps < REPS_MIN || reps > REPS_MAX || !Number.isInteger(reps)) {
        state.repsError = "Enter whole reps like 8";
        return;
      }
      state.repsError = null;
      const active = activeSet(state);
      if (active === null || state.workoutComplete) return;
      if (expectedSetId !== undefined && active.setId !== expectedSetId) return;
      const record = workoutServices(context);
      const now = record.now();
      if (state.lastCompletedAt !== null) {
        const elapsed = now - state.lastCompletedAt;
        if (elapsed >= 0 && elapsed < 1000) return;
      }
      state.lastCompletedAt = now;
      const entry = FOCUS_WORKOUT.entries[active.entryIndex]!;
      state.completedSets = [...(state.completedSets ?? []), active.setId];
      // Commit what the user entered, keyed by set id (review P1).
      state.results = { ...(state.results ?? {}), [active.setId]: {
        weight: formatWeight(weight), reps: formatReps(Math.round(reps)),
      } };
      state.weightError = null;
      state.repsError = null;
      Object.assign(state, advanceFrom(state));
      if (state.workoutComplete) {
        // The last set is done: no rest follows, and the status alert already
        // says the workout is complete (nothing left to announce).
        state.restPhase = "idle";
        state.restDeadline = null;
        state.restRemainingMs = 0;
        return;
      }
      // Foreground rest countdown: a deadline plus injected now. Ticks chain
      // at ~1 Hz (see restTick) so the host-painted ring advances without
      // per-frame JS work; the tick at/past the deadline completes the rest.
      state.restPhase = "running";
      state.restRemainingMs = entry.restSeconds * 1000;
      state.restDeadline = record.now() + state.restRemainingMs;
      record.scheduleRestTick(Math.min(state.restRemainingMs, 1000));
    },
    restTick(context: ScreenActionContext<FocusState>) {
      const { state, input } = context;
      const now = checkedNow(input);
      if (state.restPhase !== "running" || state.restDeadline === null) return;
      // Remaining is always deadline − now: a late callback cannot accumulate drift.
      const remaining = state.restDeadline - now;
      if (remaining <= 0) {
        state.restPhase = "idle";
        state.restRemainingMs = 0;
        state.restRound = state.restRound + 1;
        return;
      }
      state.restRemainingMs = remaining;
      // ~1 Hz foreground repaints toward the deadline; the tick landing at or
      // past the deadline completes the rest. Paused/idle states stop the
      // chain by ignoring ticks without rescheduling.
      workoutServices(context).scheduleRestTick(Math.min(remaining, 1000));
    },
    restPause(context: ScreenActionContext<FocusState>) {
      const { state } = context;
      if (state.restPhase !== "running") return;
      // Freeze the ACTUAL remaining time at the pause instant, not the last
      // tick's cached value — a pause between ticks must not add elapsed
      // time back on resume (review P2).
      state.restRemainingMs = Math.max(0, (state.restDeadline ?? 0) - workoutServices(context).now());
      state.restPhase = "paused";
    },
    restResume(context: ScreenActionContext<FocusState>) {
      const { state } = context;
      if (state.restPhase !== "paused") return;
      const record = workoutServices(context);
      state.restDeadline = record.now() + state.restRemainingMs;
      state.restPhase = "running";
      record.scheduleRestTick(Math.min(state.restRemainingMs, 1000));
    },
    restSkip({ state }: ScreenActionContext<FocusState>) {
      if (state.restPhase === "idle") return;
      state.restPhase = "idle";
      state.restDeadline = null;
      state.restRemainingMs = 0;
      state.restRound = state.restRound + 1;
    },
    rebaseClock(context: ScreenActionContext<FocusState>) {
      const { state, input } = context;
      const now = checkedNow(input);
      state.lastCompletedAt = null;
      if (state.restPhase === "running") {
        state.restDeadline = now + state.restRemainingMs;
        workoutServices(context).scheduleRestTick(Math.min(state.restRemainingMs, 1000));
      }
    },
  },
  view({ state, actions }) {
    const entry = FOCUS_WORKOUT.entries[state.entryIndex]!;
    const set = entry.sets[state.setIndex]!;
    const doneCount = state.completedSets.length;
    const totalCount = FOCUS_WORKOUT.entries.reduce((sum, item) => sum + item.sets.length, 0);
    const restVisible = state.restPhase !== "idle";
    const statusMessage = state.workoutComplete
      ? "Workout complete — every set is done"
      : state.restPhase === "idle" && state.restRemainingMs === 0
        ? "Rest complete — next set is ready"
        : "Ready";
    return (
      <Scaffold appBar={<AppBar title="Focus Workout" />}>
        <Column padding="lg" gap="md" align="stretch">
          <Card padding="md" radius="md" background="surfaceRaised">
            <Column gap="xs" align="stretch">
              <Text variant="caption">Exercise</Text>
              <Text variant="title" semanticsId={`workout.entry.${entry.exerciseId}`}>{entry.name}</Text>
              <Text variant="caption">{doneCount} of {totalCount} sets done</Text>
            </Column>
          </Card>

          <Card padding="md" radius="md" background="surfaceRaised">
            <Column gap="sm" align="stretch">
              <Text variant="title">Set {state.setIndex + 1} of {entry.sets.length}</Text>
              <Row gap="sm" align="stretch">
                <Button variant="tonal" semanticsId={stepAction(entry.id, set.id, "weight", "down")}
                  onPress={() => actions.stepWeight("down")}>−</Button>
                <Expanded>
                  <TextField
                    id={fieldAction(entry.id, set.id, "weight")}
                    label="Weight (kg)"
                    keyboardType="decimal"
                    inputAction="next"
                    value={state.weightDraft}
                    onChanged={actions.editWeight}
                  />
                </Expanded>
                <Button variant="tonal" semanticsId={stepAction(entry.id, set.id, "weight", "up")}
                  onPress={() => actions.stepWeight("up")}>+</Button>
              </Row>
              {state.weightError === null ? null : (
                <Text variant="caption" color={colorSlot("error")}>{state.weightError}</Text>
              )}
              <Row gap="sm" align="stretch">
                <Button variant="tonal" semanticsId={stepAction(entry.id, set.id, "reps", "down")}
                  onPress={() => actions.stepReps("down")}>−</Button>
                <Expanded>
                  <TextField
                    id={fieldAction(entry.id, set.id, "reps")}
                    label="Reps"
                    keyboardType="number"
                    value={state.repsDraft}
                    onChanged={actions.editReps}
                  />
                </Expanded>
                <Button variant="tonal" semanticsId={stepAction(entry.id, set.id, "reps", "up")}
                  onPress={() => actions.stepReps("up")}>+</Button>
              </Row>
              {state.repsError === null ? null : (
                <Text variant="caption" color={colorSlot("error")}>{state.repsError}</Text>
              )}
              {state.workoutComplete
                ? <Button variant="secondary">Workout complete</Button>
                : <Button
                    semanticsId={completeAction(entry.id, set.id)}
                    onPress={() => actions.completeSet(set.id)}>Complete set</Button>}
            </Column>
          </Card>

          {restVisible ? (
            <Card padding="md" radius="md" background="surfaceRaised">
              <Column gap="sm" align="stretch">
                <Text variant="title">Rest</Text>
                <Row gap="md">
                  <ProgressRing value={state.restRemainingMs} goal={REST_DURATION_MS} size={96}
                    caption={formatClock(state.restRemainingMs)} />
                  <Column gap="sm">
                    <Text semanticsId="rest.ring">{formatClock(state.restRemainingMs)} remaining</Text>
                    <Row gap="sm">
                      {state.restPhase === "running" ? (
                        <Button variant="text" semanticsId="rest.pause" onPress={() => actions.restPause()}>Pause</Button>
                      ) : (
                        <Button variant="text" semanticsId="rest.resume" onPress={() => actions.restResume()}>Resume</Button>
                      )}
                      <Button variant="text" semanticsId="rest.skip" onPress={() => actions.restSkip()}>Skip</Button>
                    </Row>
                  </Column>
                </Row>
              </Column>
            </Card>
          ) : null}

          <Card padding="sm" radius="sm" background="surface"
            semantics={{ id: statusSemantics(entry.id, set.id), role: "alert", label: statusMessage }}>
            <Text variant="caption">{statusMessage}</Text>
          </Card>

          <Expanded>
            <ScrollView id="workout-sets">
              <Column gap="sm" align="stretch">
                {entry.sets.map((item, index) => {
                  const done = (state.completedSets ?? []).includes(item.id);
                  const result = (state.results ?? {})[item.id];
                  return (
                    <Row key={item.id} gap="md">
                      <Text variant="caption">Set {index + 1}</Text>
                      <Text variant="caption" color={colorSlot(done ? "success" : "onSurfaceVariant")}>
                        {done && result
                          ? `Done — ${result.weight} kg × ${result.reps}`
                          : done
                            ? `Done — ${formatWeight(item.weight)} kg × ${formatReps(item.reps)}`
                            : "Ready"}
                      </Text>
                    </Row>
                  );
                })}
              </Column>
            </ScrollView>
          </Expanded>
        </Column>
      </Scaffold>
    );
  },
});
