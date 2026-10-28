import { defineScreen, type ScreenActionContext } from "@tenunjs/core";
import { AppBar, Button, Card, Column, Expanded, Row, Scaffold, Text } from "@tenunjs/widgets";
import { navigatePlan, PLAN_TASKS } from "../plan";

export interface TodayState {
  completed: number;
}

export const TodayScreen = defineScreen({
  name: "Today",
  initialState: (): TodayState => ({ completed: 0 }),
  actions: {
    completeTask({ state }: ScreenActionContext<TodayState>) {
      state.completed = Math.min(PLAN_TASKS.length, state.completed + 1);
    },
    viewProgress({ state, services }: ScreenActionContext<TodayState>) {
      navigatePlan(services, "progress", state.completed);
    },
  },
  view({ state, actions }) {
    return (
      <Scaffold appBar={<AppBar title="Day Plan" />}>
        <Column padding="lg" gap="md" align="stretch">
          <Row gap="md" align="stretch">
            <Expanded>
              <Card padding="md" radius="md" background="surfaceRaised">
                <Column gap="xs">
                  <Text variant="caption">Plan</Text>
                  <Text variant="title">Release day</Text>
                </Column>
              </Card>
            </Expanded>
            <Expanded>
              <Card padding="md" radius="md" background="surfaceRaised">
                <Column gap="xs">
                  <Text variant="caption">Completed</Text>
                  <Text variant="title">{state.completed} / {PLAN_TASKS.length}</Text>
                </Column>
              </Card>
            </Expanded>
          </Row>

          <Expanded>
            <Card padding="md" radius="lg" background="surfaceRaised">
              <Column gap="md" align="stretch">
                <Text variant="title">Today's checklist</Text>
                <Expanded>
                  <Row gap="md" align="stretch">
                    <Expanded flex={2}>
                      <Column gap="sm" align="stretch">
                        {PLAN_TASKS.map((task, index) => (
                          <Card key={task} padding="sm" radius="sm" background="surface">
                            <Column gap="xs">
                              <Text>{task}</Text>
                              <Text variant="caption">
                                {index < state.completed ? "Done" : "Ready"}
                              </Text>
                            </Column>
                          </Card>
                        ))}
                      </Column>
                    </Expanded>
                    <Expanded>
                      <Card padding="sm" radius="sm" background="surface">
                        <Column gap="sm">
                          <Text variant="title">Next</Text>
                          <Text>{state.completed === PLAN_TASKS.length
                            ? "The checklist is complete. Inspect your progress."
                            : "Finish one task, then inspect your progress."}</Text>
                        </Column>
                      </Card>
                    </Expanded>
                  </Row>
                </Expanded>
              </Column>
            </Card>
          </Expanded>

          <Row gap="md" align="stretch">
            <Expanded><Button onPress={actions.completeTask}>Complete task</Button></Expanded>
            <Expanded><Button variant="tonal" onPress={actions.viewProgress}>View progress</Button></Expanded>
          </Row>
        </Column>
      </Scaffold>
    );
  },
});
