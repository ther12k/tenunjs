# Examples

Sample applications written the way TenunJS applications are meant to be
written: TypeScript + TSX, controller actions own state, views are pure
functions of committed state, and layout is declared through typed widget
composition — no React, no hooks, no CSS.

> **Status: API previews, not runnable products.** TenunJS cannot build and
> ship an application yet (see the repository README): the executable
> application model lands in M3 and the usable widget layer in M4. These
> samples compile against today's `@tenunjs/*` packages, their controller
> and view logic is exercised by tests, and each is a valid TN-021
> application project with a complete TN-022 module graph — but nothing
> here installs or runs on a device, and names may change before beta.

## The samples

| Example | Demonstrates |
| --- | --- |
| [counter](counter/) | The canonical first app: `runApp` entry, typed theme, single-file screen with an action table. Mirrors [04-api/counter-app-example.md](../04-api/counter-app-example.md). |
| [todo-list](todo-list/) | List state in actions: typed action inputs (`toggleTask(id)`), conditional empty state, derived counts. |
| [calculator](calculator/) | Layout composition (nested `Row`/`Column` grid), a custom function widget, one typed action driving a small state machine. |
| [navigation-demo](navigation-demo/) | App skeleton: typed routes with `defineRoutes`, `NavigationHost`, and the split controller/view pattern with async `load()` and an injected service. |
| [gallery](gallery/) | All-in-one UI/UX showcase inspired by public Flutter design studies: Rally-style banking, a smart-home dashboard, a fitness tracker, a Shrine-style store, and grouped settings — five modules, one app. |
| [flutter-showcase](flutter-showcase/) | Launcher plus five independent app studies based on Best-Flutter-UI-Templates: introduction, hotel booking, fitness, design course, and custom drawer — one session each, no shared state. |
| [flutter-showcase-preview](flutter-showcase-preview/) | Launcher-host browser UI lab for the studies at `/showcase/`: open/close apps like a native home screen with per-app state preserved and state-preserving hot reload. |
| [gallery-preview](gallery-preview/) | Desktop/browser UI lab for the gallery: same screen state/actions, display-list rendering, drag scrolling, and hot reload before APK packaging. |

## What is verified today

- `bun run typecheck` typechecks every example through
  `examples/tsconfig.json`, which compiles TSX with the automatic TenunJS
  transform (`jsxImportSource: @tenunjs/jsx-runtime`, TN-020).
- Each example is a workspace member declaring real `@tenunjs/*`
  dependencies and carrying a `tenun.config.ts` validated by
  `defineConfig` (TN-021).
- `examples/test-support` mounts every screen the way the runtime will:
  fresh `initialState()`, actions invoked through a real action context,
  `view()` rendered from committed state. Covered by `bun test`.
- `examples/test-support/test/examples-graph.test.ts` builds the TN-022
  application module graph for every sample and requires it to resolve
  every import with no cycles and no diagnostics.

## Layout

```text
examples/
├── counter/           single-file screen: entry, theme, actions, routes
├── todo-list/         list state, keyed children, typed action inputs
├── calculator/        layout grid, custom widget, action state machine
├── navigation-demo/   typed routes, NavigationHost, split controller/view
├── gallery/           all-in-one UI/UX showcase: fifteen Flutter-inspired modules
├── flutter-showcase/  focused category showcase based on Best-Flutter-UI-Templates
├── flutter-showcase-preview/ separate browser UI lab for the focused showcase
├── gallery-preview/   browser UI lab with canvas renderer and hot reload
├── test-support/      shared screen harness + cross-example graph gate
├── tsconfig.json      shared TSX settings (automatic TenunJS transform)
└── globals.d.ts       intended embedder globals (`__DEV__`)
```

## Adding an example

1. Create `examples/<name>/` with a `package.json` (it becomes a workspace
   member), a `tenun.config.ts` (`projectName` must match
   `/^[a-z][a-z0-9-]*$/`), and `src/main.tsx` as the entry.
2. Import only the implemented surface of `@tenunjs/*`; document anything
   aspirational in the example's README instead of inventing imports.
3. Add tests under `examples/<name>/test/` using
   `@tenunjs-examples/test-support`. The module-graph gate picks the new
   example up automatically from its `tenun.config.ts`.
