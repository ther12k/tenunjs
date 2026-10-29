import { defineScreen, type ScreenActionContext } from "@tenunjs/core";
import { AppBar, Button, Card, Column, Expanded, Row, Scaffold, Text } from "@tenunjs/widgets";
import { CanvasBox } from "@tenunjs-examples/ui-kit";
import { checkedPlanProgress, defaultPlanTitle, navigatePlan, PLAN_TASKS, type PlanProgress } from "../plan";

export interface ProgressState {
  completed: number;
  planTitle?: string;
  detailsVisible: boolean;
}

export const ProgressScreen = defineScreen({
  name: "Progress",
  initialState: (): ProgressState => ({ completed: 0, planTitle: defaultPlanTitle, detailsVisible: false }),
  actions: {
    receiveProgress({ state, input }: ScreenActionContext<ProgressState, PlanProgress>) {
      const progress = checkedPlanProgress(input);
      state.completed = progress.completed;
      state.planTitle = progress.planTitle;
    },
    toggleDetails({ state }: ScreenActionContext<ProgressState>) {
      state.detailsVisible = !state.detailsVisible;
    },
    backToToday({ services }: ScreenActionContext<ProgressState>) {
      navigatePlan(services, "today");
    },
  },
  view({ state, actions }) {
    const progress = state.completed / PLAN_TASKS.length;
    const planTitle = state.planTitle === undefined ? defaultPlanTitle : state.planTitle;
    return (
      <Scaffold appBar={<AppBar title="Progress" />}>
        <Column padding="lg" gap="md" align="stretch">
          <Card padding="md" radius="md" background="surfaceRaised">
            <Column gap="xs">
              <Text variant="caption">{planTitle || "Untitled plan"}</Text>
              <Text variant="title">{state.completed} of {PLAN_TASKS.length} complete</Text>
            </Column>
          </Card>

          <Expanded>
            <Card padding="md" radius="lg" background="surfaceRaised">
              <Column gap="md" align="stretch" justify="center">
                <CanvasBox
                  height={200}
                  paint={({ w }, put, _tap, palette) => {
                    // Only this visual is custom drawing. Card, text, layout,
                    // and buttons above/below remain ordinary TSX widgets.
                    put({ op: "ring", cx: w / 2, cy: 100, r: 76, width: 16,
                      progress, color: palette.primary, track: palette.surfaceContainer });
                    put({ op: "text", x: 0, y: 112, width: w, align: "center",
                      text: `${Math.round(progress * 100)}%`, size: 36, weight: 700, color: palette.onSurface });
                  }}
                />
                <Text variant="title">Small steps add up.</Text>
                {state.detailsVisible ? (
                  <Text>Review layout, check interactions, and record a demo.</Text>
                ) : null}
              </Column>
            </Card>
          </Expanded>

          <Row gap="md" align="stretch">
            <Expanded><Button variant="tonal" onPress={actions.backToToday}>Back to today</Button></Expanded>
            <Expanded>
              <Button onPress={actions.toggleDetails}>{state.detailsVisible ? "Hide details" : "Show details"}</Button>
            </Expanded>
          </Row>
        </Column>
      </Scaffold>
    );
  },
});
