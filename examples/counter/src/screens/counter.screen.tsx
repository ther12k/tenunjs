import {
  defineScreen,
  type ScreenActionContext,
} from "@tenunjs/core";

import {
  AppBar,
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";

export interface CounterState {
  count: number;
}

export const CounterScreen = defineScreen({
  name: "Counter",

  initialState: (): CounterState => ({
    count: 0,
  }),

  actions: {
    increment({ state }: ScreenActionContext<CounterState>) {
      state.count += 1;
    },

    decrement({ state }: ScreenActionContext<CounterState>) {
      state.count -= 1;
    },

    reset({ state }: ScreenActionContext<CounterState>) {
      state.count = 0;
    },
  },

  view({ state, actions }) {
    return (
      <Scaffold appBar={<AppBar title="Counter" />}>
        <Column
          padding="lg"
          gap="lg"
          align="center"
          justify="center"
        >
          <Card
            padding="lg"
            radius="lg"
            background="surfaceRaised"
            semantics={{
              role: "group",
              label: "Current counter value",
            }}
          >
            <Text variant="display">{state.count}</Text>
          </Card>

          <Row gap="md">
            <Button
              variant="secondary"
              onPress={actions.decrement}
            >
              Decrease
            </Button>

            <Button onPress={actions.increment}>
              Increase
            </Button>
          </Row>

          <Button
            variant="secondary"
            onPress={actions.reset}
          >
            Reset
          </Button>
        </Column>
      </Scaffold>
    );
  },
});
