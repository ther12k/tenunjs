import { defineAction, defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import { ListTile, ProgressBar, ProgressRing } from "@tenunjs-examples/ui-kit";

/**
 * Fitness tracker module: three activity rings (steps/move/stand), a
 * weekly steps list with progress bars, and today's workout card — the
 * classic Flutter health reference layout.
 */
export interface FitnessState {
  readonly stepsToday: number;
  readonly stepGoal: number;
  readonly moveKcal: number;
  readonly moveGoal: number;
  readonly standHours: number;
  readonly standGoal: number;
  readonly week: ReadonlyArray<{ day: string; steps: number }>;
  readonly workout: { name: string; minutes: number; kcal: number } | null;
}

export const FitnessScreen = defineScreen({
  name: "Fitness",

  initialState: (): FitnessState => ({
    stepsToday: 4820,
    stepGoal: 8000,
    moveKcal: 210,
    moveGoal: 400,
    standHours: 7,
    standGoal: 12,
    week: [
      { day: "Mon", steps: 6100 },
      { day: "Tue", steps: 9400 },
      { day: "Wed", steps: 5200 },
      { day: "Thu", steps: 8100 },
      { day: "Fri", steps: 4820 },
      { day: "Sat", steps: 0 },
      { day: "Sun", steps: 0 },
    ],
    workout: { name: "Morning run", minutes: 32, kcal: 310 },
  }),

  actions: {
    /** Logs a walk: adds steps and derived move energy. */
    logWalk: defineAction<FitnessState, number>({
      run({ input, state }) {
        const steps = Math.max(0, Math.floor(input));
        (state as unknown as { stepsToday: number }).stepsToday = state.stepsToday + steps;
        (state as unknown as { moveKcal: number }).moveKcal = state.moveKcal + Math.round(steps * 0.04);
        const week = state.week.map((d, i) =>
          i === 4 ? { ...d, steps: d.steps + steps } : d
        );
        (state as unknown as { week: FitnessState["week"] }).week = week;
      },
    }),

    completeWorkout: defineAction<FitnessState, void>({
      run({ state }) {
        if (!state.workout) return;
        (state as unknown as { moveKcal: number }).moveKcal = state.moveKcal + state.workout.kcal;
        (state as unknown as { workout: FitnessState["workout"] }).workout = null;
      },
    }),
  },

  view({ state, actions }) {
    const best = Math.max(...state.week.map((d) => d.steps), 1);

    return (
      <Scaffold appBar={<AppBar title="Fitness" />}>
        <Column padding="lg" gap="lg">
          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="sm">
              <Text variant="title">Today's rings</Text>
              <Row gap="lg">
                <ProgressRing
                  value={state.stepsToday}
                  goal={state.stepGoal}
                  caption="steps"
                  color="#4C8DFF"
                />
                <ProgressRing
                  value={state.moveKcal}
                  goal={state.moveGoal}
                  caption="kcal"
                  color="#FF5A5F"
                />
                <ProgressRing
                  value={state.standHours}
                  goal={state.standGoal}
                  caption="stand"
                  color="#3DD68C"
                />
              </Row>
            </Column>
          </Card>

          <Column gap="sm">
            <Text variant="title">This week</Text>
            {state.week.map((day) => (
              <Card key={day.day} padding="md" radius="md" background="surfaceRaised">
                <Column gap="xs">
                  <Row gap="sm" justify="between">
                    <Text variant="body">{day.day}</Text>
                    <Text variant="body" color="#9AA3B2">
                      {day.steps} steps {day.steps >= state.stepGoal ? "· goal ✓" : ""}
                    </Text>
                  </Row>
                  <ProgressBar value={day.steps} max={best} color="#4C8DFF" />
                </Column>
              </Card>
            ))}
          </Column>

          {state.workout ? (
            <ListTile
              leading={<ProgressRing value={state.workout.kcal} goal={400} size={64} color="#F5A623" />}
              title={state.workout.name}
              subtitle={`${state.workout.minutes} min · ${state.workout.kcal} kcal`}
              trailing={
                <Button variant="primary" onPress={() => actions.completeWorkout()}>
                  Complete
                </Button>
              }
            />
          ) : (
            <Card padding="md" radius="md" background="surfaceRaised">
              <Text variant="body" color="#9AA3B2">No workout planned — rest day.</Text>
            </Card>
          )}

          <Row gap="sm">
            <Button variant="secondary" onPress={() => actions.logWalk(1000)}>
              Log a 1,000-step walk
            </Button>
          </Row>
        </Column>
      </Scaffold>
    );
  },
});
