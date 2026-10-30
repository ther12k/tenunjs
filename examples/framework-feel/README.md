# Day Plan — framework-feel foundation

Day Plan is the incremental application for TN-155. The TN-157 foundation
uses ordinary TSX widgets for two screens, nested bounded layout, real
button actions, immediate navigation, retained screen sessions, and one
custom progress visual. Later slices will complete the milestone journey.
TN-158 adds automatic host viewport delivery; TN-160 adds an editable plan
title through the ordinary `TextField` widget and host editing adapters.

## Current scope

| Capability | Status |
| --- | --- |
| Ordinary `Scaffold`, `AppBar`, `Card`, `Column`, `Row`, `Expanded`, `Button`, `Text`, and `TextField` composition | Implemented in Today and Progress. |
| Bounded layout under explicit viewport changes | Runtime tests cover 720×1000, 480×840, and 1000×720; nested flex panels and footer placement respond to the supplied bounds. |
| Two screens and retained action state | Implemented through `ApplicationRuntime`; complete a task, inspect progress, show details, return, and revisit. Navigation carries a host-evaluated transition. |
| Custom drawing | One `CanvasBox` draws the progress ring and its numeric annotation. Ordinary interface elements remain widgets. |
| Shared host entry | One IIFE bundle uses the public commit/dispatch contract for both the generic browser host and QuickJS. |
| Automatic browser/Android viewport delivery | Implemented (TN-158): the generic browser host delivers canvas CSS-pixel bounds on boot and resize; the Android `SurfaceView` delivers density-independent logical bounds on surface changes and engine swaps. Both negotiate once — a bundle whose handoff has no `setViewport` answers `UNKNOWN_ACTION` and keeps its own design-width scaling. |
| Controlled single-line editing through widgets | TN-160 implements the plan-title field, guarded runtime sessions, browser native input, and Android InputConnection. The device journey edits the title through the InputConnection; live soft-keyboard/composition evidence for this TSX application stays recorded with ADR-0019. |
| Independent scroll viewport | Implemented (TN-161): the Today checklist is a `ScrollView` — bounded viewport, intrinsic content, host-owned scroll offsets; the scene carries a `scroll-region` op both hosts render and hit-test. |
| Host-evaluated animation and route transitions | Implemented (TN-169): navigations carry an optional `transition` block; both hosts interpolate on their own frame clock (Android on a dedicated animation thread — frames advance while the main thread is blocked). |
| Semantic widget colors, inherited themes, runtime switching | Implemented (TN-170): light/dark semantic palettes via `paletteTheme`, runtime `setTheme` through the invalidation channel, retained journey state across swaps. TN-068 keeps the deeper token work (ColorRef widget adoption, spacing/typography context). |
| Same-code device journey | Implemented (TN-171): the CI device gate boots this compiled bundle in the production embedder and completes the journey through real `MotionEvent`s and the InputConnection (`FrameworkFeelJourneyTest`). |

TN-155's seven requirements are implemented with evidence on every
available host; Day Plan is the README's headline demo. Font/CJK coverage
and the live soft-keyboard journey remain recorded pre-demonstration
limitations (TN-160/TN-171 notes; ADR-0019 owns the physical-device
boundary).

## Run the application tests

From the repository root after installing the pinned dependencies:

```sh
bun test examples/framework-feel
```

Screen tests exercise named actions. Runtime tests inspect emitted scenes,
nested layout, tap placement, explicit viewport changes, custom drawing,
title editing/selection/composition, and both retained screen sessions
through the public handoff. Malformed or stale editing callbacks are
rejected, and restore ends an old editing session.

`createFrameworkFeelRuntime(viewport)` in `src/runtime.ts` is the sole
runtime factory. Its default is 720×1000; callers can supply another finite
viewport and call `setViewport()` without rewriting the screen tree. The
application does not calculate child heights from the viewport.

Day Plan snapshots made before title editing omit `planTitle`. The
application displays the shared default, `Release day`, for that missing
field until an edit supplies it. An empty title remains an empty value;
rendering does not mutate restored state, and the runtime's snapshot
schema is unchanged.

## Build the portable host bundle

```sh
bun examples/framework-feel/scripts/build-host.ts \
  examples/framework-feel/.out/framework-feel-app.js
```

The builder accepts an explicit output path, emits a plain-script IIFE,
and smoke-boots it through `tenun_commit`. The configured TenunJS entry is
`src/host-entry.ts`; that entry imports the same `.tsx` screens used by
the runtime tests. There are no platform-specific screen copies.

## Browser preview through the existing generic host

Build the generic shell and serve the repository root:

```sh
bun build examples/gallery-preview/host.ts --target browser \
  --outfile examples/gallery-preview/host.js
python3 -m http.server 8898 --bind 127.0.0.1
```

Open:

[Day Plan in the generic host](http://127.0.0.1:8898/examples/gallery-preview/host.html?bundle=/examples/framework-feel/.out/framework-feel-app.js)

Tap **Plan title**, select or replace its text using the keyboard, and
submit with Enter. A tap initially places the caret at the end; pointer
caret placement and selection handles are future work. Resize while
editing to exercise session retention, then press **Complete task**,
**View progress**, **Show details**, and **Back to today**. Progress shows
the controlled title, and a second visit retains details and completion
state. An empty title appears as **Untitled plan** on Progress without
changing the controller's empty string.

The generic shell negotiates viewport support on boot: this bundle adopts
the canvas's CSS-pixel bounds and re-lays out on window resize. Older
bundles keep the scaled-scene behavior. A bundle containing the required
`text-input` descriptor needs an updated host; old hosts reject the scene.

## Native replay and device boundary

`embedders/android/run_android_test.sh` builds this same portable bundle
and replays the journey defined in `scripts/check-host-parity.ts` through
the production QuickJS bridge. The sequence includes UTF-16 selection,
Japanese composition/replacement, emoji and combining text, resize, task
actions, navigation, restore, and exact stale-session/revision rejections.
It compares twenty complete committed scenes from sixteen accepted and
three expected-rejected dispatches, including the initial scene.

Android's separate `DisplayListTextInputTest` directly drives a real
InputConnection against a small contract fixture over production JNI.
It covers adapter editing and lifecycle behavior; it is not a live
soft-keyboard test and does not load the Day Plan TSX bundle. The existing
notes-app keyboard tests continue to cover their reference application.

Scene-data parity proves the shared application path. It does not claim
pixel identity, physical-device rendering, or the complete live IME
journey. Those remain required evidence alongside TN-155's independent
scrolling, transitions, and theme integration.
