# Tenun Counter

The canonical TenunJS sample: one screen, one piece of state, three named
actions. It mirrors the reference walkthrough in
[`04-api/counter-app-example.md`](../../04-api/counter-app-example.md).

## What it demonstrates

- `runApp` application entry with an app config (`src/main.tsx`)
- Typed theme tokens via `defineTheme` (`src/theme.ts`)
- A single-file screen — `initialState`, named controller actions, and a
  pure `view` (`src/screens/counter.screen.tsx`)
- Typed routes and `NavigationHost` under a `ThemeProvider` (`src/app.tsx`)
- Accessibility intent on the counter card through the `semantics` prop

## Layout

```text
src/
├── main.tsx                     entry: runApp({ root: <App /> })
├── app.tsx                      ThemeProvider + NavigationHost
├── theme.ts                     defineTheme tokens
└── screens/counter.screen.tsx   single-file screen
```

## Verify

```sh
bun test examples/counter
```

The screen is exercised without the native engine by
`@tenunjs-examples/test-support`'s `mountScreen` harness; the module-graph
gate in `examples/test-support` additionally proves this project loads and
resolves end-to-end.
