---
okf_version: 0.2
title: "Complete Example App"
summary: "A full intended-application walkthrough: entry, theme, screen, and navigation for a counter app."
type: reference
status: accepted
---

# Complete example app: Tenun Counter

> **Status: design target.** TenunJS is not yet usable for building a real
> application. The executable application model lands in M3 and the usable
> widget layer in M4; M0 is still selecting the engine language, JavaScript
> runtime, and layout backend. This example shows how TenunJS applications
> are **intended** to be written — not something that can currently be
> installed and run with a `create-tenun` CLI. Names may change before beta.

## Intended application structure

```text
src/
├── main.tsx
├── app.tsx
├── theme.ts
└── screens/
    └── counter.screen.tsx
```

## `src/main.tsx`

```tsx
import { runApp } from '@tenunjs/core';
import { App } from './app';

runApp({
  root: <App />,
  config: {
    displayName: 'Tenun Counter',
    diagnostics: __DEV__,
  },
});
```

`runApp` is intended to validate the application bundle, runtime version,
mutation-protocol version, and native capabilities before mounting the root
application.

## `src/theme.ts`

```ts
import { defineTheme } from '@tenunjs/widgets';

export const appTheme = defineTheme({
  colors: {
    surface: '#FFFFFF',
    surfaceRaised: '#F5F6F8',
    text: '#16181D',
    accent: '#356AE6',
    danger: '#B42318',
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },

  radius: {
    sm: 6,
    md: 10,
    lg: 16,
  },

  typography: {
    body: {
      size: 16,
      lineHeight: 22,
    },
    title: {
      size: 20,
      lineHeight: 26,
      weight: 600,
    },
    display: {
      size: 48,
      lineHeight: 56,
      weight: 700,
    },
  },
});
```

TenunJS styling is intended to be typed and layout-oriented. It is not CSS:
there are no selectors, specificity rules, or cascade. Theme tokens and
widget properties compile into native widget-property blocks.

## `src/screens/counter.screen.tsx`

```tsx
import {
  defineScreen,
  type ScreenActionContext,
} from '@tenunjs/core';

import {
  AppBar,
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from '@tenunjs/widgets';

interface CounterState {
  count: number;
}

export const CounterScreen = defineScreen({
  name: 'Counter',

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
              role: 'group',
              label: 'Current counter value',
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
```

There is no React import, `useState`, dependency array, reducer provider, or
context provider. State changes happen inside named controller actions, and
the design rerenders only the owning screen root after the state transaction
commits.

## `src/app.tsx`

```tsx
import {
  NavigationHost,
  defineRoutes,
} from '@tenunjs/navigation';

import {
  ThemeProvider,
} from '@tenunjs/widgets';

import { CounterScreen } from './screens/counter.screen';
import { appTheme } from './theme';

const routes = defineRoutes({
  counter: {
    path: '/',
    screen: CounterScreen,
  },
});

export function App() {
  return (
    <ThemeProvider theme={appTheme}>
      <NavigationHost
        routes={routes}
        initial={routes.counter()}
      />
    </ThemeProvider>
  );
}
```

The intended navigation layer uses typed route construction and applies the
same validation schemas to programmatic navigation and incoming deep links.
Invalid parameters should produce a declared fallback instead of a partially
valid screen.

## What happens when the button is pressed

The intended execution path is:

```text
native touch event
    ↓
stable typed action handle
    ↓
controller state transaction
    ↓
bounded TSX reconciliation
    ↓
validated binary mutation transaction
    ↓
atomic native scene commit
    ↓
Skia renders the new frame
```

The native engine — not JavaScript — is intended to own layout, text, hit
testing, focus, semantics, gestures, scrolling, animations, resources, and
scene management. Active scrolling and animation should continue even while
JavaScript is busy.

## How a larger screen would scale

For a more realistic screen, TenunJS intends feature-local separation of
controller, view, service, types, and tests — see
[Split controller and view](split-controller-view.md).
