# Tenun Calculator

A calculator sample focused on **layout composition** and a **typed action
state machine**.

## What it demonstrates

- Nested `Row`/`Column` composition building the keypad grid, plus a
  right-aligned display row (`justify="end"`)
- A custom **function widget** (`CalcButton`) — ordinary TSX composition
  with no React: it owns no state and folds its props into the built-in
  `Button`
- One typed action driving the whole machine:
  `press: defineAction<CalculatorState, string>` takes the key label as
  its input
- Derived error handling — division by zero renders the declared
  `"Error"` display state and the next entry recovers

## Layout

```text
src/
├── main.tsx                          entry: runApp({ root: <App /> })
├── app.tsx                           ThemeProvider + NavigationHost
├── theme.ts                          dark defineTheme tokens
└── screens/calculator.screen.tsx     state machine + keypad view
```

## Verify

```sh
bun test examples/calculator
```
