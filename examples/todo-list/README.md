# Tenun Tasks

A task-list sample showing how TenunJS handles **list state inside named
actions** — no hooks, no reducers, no dependency arrays.

## What it demonstrates

- An array in controller state with id-stable tasks
  (`src/screens/tasks.screen.tsx`)
- Typed action inputs: `toggleTask`/`removeTask` are `defineAction`s taking
  a task `id`, while `addTask`/`clearCompleted` are plain input-less
  handlers — both shapes live side by side in one action table
- Conditional rendering (declared empty state) and derived view data: the
  "N of M done" summary is computed in `view`, never stored

## Layout

```text
src/
├── main.tsx                    entry: runApp({ root: <App /> })
├── app.tsx                     ThemeProvider + NavigationHost
├── theme.ts                    defineTheme tokens
└── screens/tasks.screen.tsx    single-file screen with the task list
```

## A deliberate limitation

There is no text input yet: the "Add a task" action rotates through sample
titles. The `input` host widget lands with the usable widget layer in M4.
Rows are also rendered without JSX keys for now — keying mapped function
widgets needs a widget-layer props update — while the runtime's key domain
(`string | number`, no coercion) is already defined.

## Verify

```sh
bun test examples/todo-list
```
