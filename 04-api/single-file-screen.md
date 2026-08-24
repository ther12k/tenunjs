---
okf_version: 0.2
title: "Single-file Screen API"
summary: "A complete small screen in one TSX file."
type: reference
status: accepted
---

# Single-file screen

```tsx
import {
  defineScreen,
  type ScreenActionContext,
} from '@tenunjs/core';
import {
  AppBar,
  Button,
  Column,
  Scaffold,
  Text,
} from '@tenunjs/widgets';

export default defineScreen({
  name: 'Counter',

  initialState: () => ({ count: 0 }),

  actions: {
    increment({ state }: ScreenActionContext<{ count: number }>) {
      state.count += 1;
    },

    reset({ state }) {
      state.count = 0;
    },
  },

  view({ state, actions }) {
    return (
      <Scaffold appBar={<AppBar title="Counter" />}>
        <Column
          padding="lg"
          gap="md"
          align="center"
          justify="center"
        >
          <Text variant="display">{state.count}</Text>
          <Button onPress={actions.increment}>Increase</Button>
          <Button variant="secondary" onPress={actions.reset}>
            Reset
          </Button>
        </Column>
      </Scaffold>
    );
  },
});
```

There are no React imports or hooks. Actions are stable typed handles, and the runtime re-renders only the owning screen root after committed state changes.
