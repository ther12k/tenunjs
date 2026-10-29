import { defineScreen, type ScreenActionContext } from "@tenunjs/core";
import { AppBar, Button, Card, Column, Expanded, Row, Scaffold, Text, TextField } from "@tenunjs/widgets";
import { checkedPlanTitle, defaultPlanTitle, navigatePlan, PLAN_TASKS } from "../plan";

export interface TodayState {
  completed: number;
  planTitle?: string;
}

export const TodayScreen = defineScreen({
  name: "Today",
  initialState: (): TodayState => ({ completed: 0, planTitle: defaultPlanTitle }),
  actions: {
    changePlanTitle({ state, input }: ScreenActionContext<TodayState, string>) {
      state.planTitle = checkedPlanTitle(input);
    },
    completeTask({ state }: ScreenActionContext<TodayState>) {
      state.completed = Math.min(PLAN_TASKS.length, state.completed + 1);
    },
    viewProgress({ state, services }: ScreenActionContext<TodayState>) {
      navigatePlan(services, "progress", {
        completed: state.completed,
        planTitle: state.planTitle === undefined ? defaultPlanTitle : state.planTitle,
      });
    },
  },
  view({ state, actions }) {
    return (
      <Scaffold appBar={<AppBar title="Day Plan" />}>
        <Column padding="lg" gap="md" align="stretch">
          <Card padding="md" radius="md" background="surfaceRaised">
            <Column gap="sm" align="stretch">
              <TextField
                id="plan-title"
                label="Plan title"
                placeholder="Name this plan"
                value={state.planTitle === undefined ? defaultPlanTitle : state.planTitle}
                onChanged={actions.changePlanTitle}
              />
              <Row gap="sm">
                <Text variant="caption">Completed</Text>
                <Text variant="caption">{state.completed} / {PLAN_TASKS.length}</Text>
              </Row>
            </Column>
          </Card>

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
