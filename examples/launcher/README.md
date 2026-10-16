# Tenun Launcher

The app-drawer sample: a glyph grid over the TN-147 launcher capability
seam, with hold-to-open app options through the TN-148 long-press
gesture. It is the launcher-track proof that the framework seams a real
home-screen app needs — enumerate, launch, hold — are frozen and usable.

## What it demonstrates

- Binding the `LauncherCapability` contract (`@tenunjs/platform`) through
  the runtime's services context — the host composes it in; a host
  without it renders the degradation surface, never a broken grid
- The `Wrap` flow layout as an app grid, `SizedBox` tiles, host-picked
  glyph monograms (`iconGlyph`, label-initial fallback)
- `GestureDetector` dual gestures: tap launches, long-press opens the
  app's options panel
- Availability-aware failure states (`denied` routes to a permission
  hint; anything else names the failure kind) with a Retry action

## Layout

```text
src/
├── main.tsx                    entry: runApp({ root: <App /> })
├── app.tsx                     ThemeProvider + NavigationHost
├── theme.ts                    mecha-cockpit dark tokens
└── screens/home.screen.tsx     the drawer: load, grid, launch, options
```

## Host wiring

The screen reads `services.launcher`. A host composes the capability via
`defineHostCapabilities({ launcher })` (Android: a PackageManager binding
behind `listApps`/`launch`; browsers/test doubles: the fail-closed
`unsupportedLauncher` stub or a fake). Search is deliberately absent in
v1: the display-list contract lowers no text-input widget yet, and the
sample stays honest with what actually renders.

## Verify

```sh
bun test examples/launcher
```

The screen is exercised without the native engine by
`@tenunjs-examples/test-support`'s `mountScreen` harness, including a
`layoutScreen` pass proving the ready state lowers to a display-list
scene with per-tile `long-press` regions; the module-graph gate in
`examples/test-support` additionally proves this project loads and
resolves end-to-end.
