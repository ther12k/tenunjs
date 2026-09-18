# Flutter Showcase Preview

Desktop/browser UI lab for `examples/flutter-showcase`, shaped as a small
**launcher host**: the front surface is an app library showing all five
studies, and opening one feels like launching a native app — the library
gets out of the way, a host back control ("← App library", or press `H`)
returns to it, and the study's state is still there when you reopen it.

It runs the same launcher screen, category screens, controller state, typed
actions, and display-list renderer used by the TenunJS example package, so
the UI can be explored before APK packaging.

## Run it

From the repository root:

```bash
bun run gallery:preview
```

Open [http://127.0.0.1:8898/showcase/](http://127.0.0.1:8898/showcase/).

## The two state layers

The runtime (`runtime.ts`) deliberately separates:

1. **Host state** — which surface is frontmost (`launcher` or `app`) and
   which app is active, plus the launcher session itself (last opened,
   drawer).
2. **App sessions** — one lazily mounted session per app id
   (`intro`, `hotel`, `fitness`, `course`, `navigation`), each owning its
   real controller state and typed actions.

`openApp(id)` mounts a session once and brings it forward; `closeApp()`
returns to the library **without destroying the session** — exactly the
native home-screen metaphor. Reopening resumes in place; there is currently
no explicit "reset app" action (a future host-level concern, deliberately
not mixed into screen state).

Snapshots carry this split explicitly: `{ stateSchema: 2, surface, appId,
launcherState, appStates }`. Flat schema-1 snapshots (`{ route, states }`)
still restore via a small migration, so old hosts and saved states keep
working.

## Interactions

- The first surface is a home-screen grid of app icons — tap an icon (or the
  drawer, or the host `__showcaseOpen` hook) to launch that study full-screen.
- Use **← App library** or press `H` to close the active study; reopen it
  to find filters, progress, and onboarding position preserved.
- Click buttons, chips, cards, and controls to dispatch real typed actions.
- Drag vertically to scroll long screens.
- Edit a showcase or UI-kit source file; the preview polls the showcase hash
  and reloads the app bundle while restoring surface, launcher state, and
  every app session.

## Automation hooks

`__showcaseOpen(id)`, `__showcaseClose()`, `__showcaseSurface()`,
`__showcaseState()`, `__showcaseTap(payloadId)`, `__showcaseTaps()`, and
`__showcaseScroll(y)` expose the host lifecycle and stable payload-ID
dispatch for tooling.

## Rendering boundary

The preview reuses the browser Canvas 2D adapter and the shared display-list
contract (`rect`, `outline`, `text`, `circle`, `ring`, `line`, `gradient`,
and stable tap payload IDs). It is intentionally vector-only and does not
fetch remote Flutter assets. The renderer remains isolated so a
CanvasKit/Skia WASM backend can be added later without changing the
showcase runtime.

This is a UI iteration surface, not proof that the future M4 native widget
host is complete. Android TN-132 acceptance remains a separate gate.
