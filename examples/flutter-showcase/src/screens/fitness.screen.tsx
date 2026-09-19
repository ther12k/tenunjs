import { defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Button,
  Card,
  Column,
  Expanded,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import {
  Avatar,
  CanvasBox,
  Chip,
  ListTile,
  ProgressBar,
  ProgressRing,
  textWidth,
} from "@tenunjs-examples/ui-kit";
import { FITNESS_WEEK, WORKOUTS } from "../categories/fitness";

export interface FitnessShowcaseState {
  stepsToday: number;
  moveKcal: number;
  standHours: number;
  selectedWorkout: number;
  completedWorkout: boolean;
  week: Array<{ day: string; steps: number }>;
}

export const FitnessShowcaseScreen = defineScreen({
  name: "FitnessTemplate",

  initialState: (): FitnessShowcaseState => ({
    stepsToday: 4820,
    moveKcal: 210,
    standHours: 7,
    selectedWorkout: 0,
    completedWorkout: false,
    week: FITNESS_WEEK.map((day) => ({ ...day })),
  }),

  actions: {
    logWalk({ state, input }: { state: FitnessShowcaseState; input: number }) {
      const steps = Math.max(0, Math.floor(input));
      state.stepsToday += steps;
      state.moveKcal += Math.round(steps * 0.04);
      state.week[4] = { ...state.week[4]!, steps: state.week[4]!.steps + steps };
    },
    selectWorkout({ state, input }: { state: FitnessShowcaseState; input: number }) {
      state.selectedWorkout = Math.max(0, Math.min(WORKOUTS.length - 1, Math.floor(input)));
      state.completedWorkout = false;
    },
    completeWorkout({ state }: { state: FitnessShowcaseState }) {
      if (state.completedWorkout) return;
      const workout = WORKOUTS[state.selectedWorkout]!;
      state.moveKcal += workout.kcal;
      state.completedWorkout = true;
    },
    resetWorkout({ state }: { state: FitnessShowcaseState }) {
      state.completedWorkout = false;
    },
  },

  view({ state, actions }) {
    const selected = WORKOUTS[state.selectedWorkout]!;
    const best = Math.max(...state.week.map((day) => day.steps), 1);
    return (
      <Scaffold appBar={<AppBar title="Fitness template" />}>
        <Column padding="lg" gap="lg">
          <Row justify="between" align="center">
            <Column gap="xs">
              <Text variant="caption" color="#AEB8C8">FRIDAY, 24 MAY</Text>
              <Text variant="title">Good morning, Rizky</Text>
            </Column>
            <Avatar label="RZ" size={48} color="#70D6A2" textColor="#122019" />
          </Row>

          <Card padding="lg" radius="lg" background="surfaceRaised">
            <Column gap="md">
              <Row justify="between" align="center">
                <Column gap="xs">
                  <Text variant="title">Today's progress</Text>
                  <Text variant="body" color="#AEB8C8">A little movement adds up.</Text>
                </Column>
                <Chip label="Live" selected />
              </Row>
              <Row gap="lg">
                <ProgressRing value={state.stepsToday} goal={8000} caption="steps" color="#7DC8D6" />
                <ProgressRing value={state.moveKcal} goal={400} caption="kcal" color="#F5A56B" />
                <ProgressRing value={state.standHours} goal={12} caption="stand" color="#70D6A2" />
              </Row>
            </Column>
          </Card>

          <Row gap="md">
            <Expanded>
              <Card padding="md" radius="lg" background="surfaceRaised">
                <Column gap="xs"><Text variant="caption" color="#AEB8C8">STEPS</Text><Text variant="headline">{state.stepsToday}</Text><Text variant="caption" color="#70D6A2">{Math.round((state.stepsToday / 8000) * 100)}% of goal</Text></Column>
              </Card>
            </Expanded>
            <Expanded>
              <Card padding="md" radius="lg" background="surfaceRaised">
                <Column gap="xs"><Text variant="caption" color="#AEB8C8">ENERGY</Text><Text variant="headline">{state.moveKcal}</Text><Text variant="caption" color="#F5A56B">active kcal</Text></Column>
              </Card>
            </Expanded>
          </Row>

          <Row justify="between" align="center">
            <Text variant="title">This week</Text>
            <Text variant="caption" color="#AEB8C8">{Math.max(...state.week.map((day) => day.steps))} best</Text>
          </Row>
          <Column gap="sm">
            {state.week.map((day) => (
              <Card key={day.day} padding="md" radius="md" background="surfaceRaised">
                <Column gap="xs">
                  <Row justify="between"><Text variant="body">{day.day}</Text><Text variant="caption" color="#AEB8C8">{day.steps} steps</Text></Row>
                  <ProgressBar value={day.steps} max={best} color={day.day === "Fri" ? "#F5A56B" : "#7DC8D6"} />
                </Column>
              </Card>
            ))}
          </Column>

          <Row justify="between" align="center">
            <Text variant="title">Choose a workout</Text>
            <Text variant="caption" color="#AEB8C8">{WORKOUTS.length} plans</Text>
          </Row>
          <Column gap="sm">
            {WORKOUTS.map((workout, index) => (
              <ListTile
                key={workout.id}
                variant={index === state.selectedWorkout ? "elevated" : "filled"}
                leading={<Avatar label={workout.glyph} size={48} color={workout.tint} textColor="#F5F7FB" />}
                title={workout.name}
                subtitle={`${workout.minutes} min · ${workout.kcal} kcal`}
                trailing={<Button variant={index === state.selectedWorkout ? "primary" : "text"} onPress={() => actions.selectWorkout(index)}>{index === state.selectedWorkout ? "Selected" : "Choose"}</Button>}
              />
            ))}
          </Column>

          <CanvasBox
            height={124}
            paint={(origin, put, _tap, palette) => {
              put({ op: "gradient", x: 0, y: 0, w: origin.w, h: 124, r: 24, color: selected.tint, colorTo: "#12161F", shadow: 6 });
              put({ op: "text", x: 24, y: 38, text: "NEXT UP", size: 13, weight: 700, color: "#BFFFFFFF" });
              put({ op: "text", x: 24, y: 78, text: selected.name, size: 24, weight: 700, color: palette.onSurface });
              put({ op: "text", x: origin.w - textWidth(`${selected.minutes} min`, 15) - 24, y: 78, text: `${selected.minutes} min`, size: 15, weight: 600, color: "#D8ECFF" });
            }}
          />
          {state.completedWorkout ? (
            <Card padding="lg" radius="lg" background="surfaceRaised">
              <Column gap="sm"><Text variant="title">Workout complete ✦</Text><Text variant="body" color="#AEB8C8">You banked {selected.kcal} active calories. Keep the rhythm going.</Text><Button variant="text" onPress={() => actions.resetWorkout()}>Choose another workout</Button></Column>
            </Card>
          ) : (
            <Row gap="sm"><Button variant="primary" onPress={() => actions.completeWorkout()}>Complete {selected.name}</Button><Button variant="secondary" onPress={() => actions.logWalk(1000)}>Log 1,000 steps</Button></Row>
          )}
        </Column>
      </Scaffold>
    );
  },
});
