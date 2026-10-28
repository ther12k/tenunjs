# Day Plan — framework-feel foundation

Day Plan is the incremental application for TN-155. The TN-157 foundation
uses ordinary TSX widgets for two screens, nested bounded layout, real
button actions, immediate navigation, retained screen sessions, and one
custom progress visual. Later slices will complete the milestone journey.

## Current scope

| Capability | Status |
| --- | --- |
| Ordinary `Scaffold`, `AppBar`, `Card`, `Column`, `Row`, `Expanded`, `Button`, and `Text` composition | Implemented in Today and Progress. |
| Bounded layout under explicit viewport changes | Runtime tests cover 720×1000, 480×840, and 1000×720; nested flex panels and footer placement respond to the supplied bounds. |
| Two screens and retained action state | Implemented through `ApplicationRuntime`; complete a task, inspect progress, show details, return, and revisit. Navigation is immediate. |
| Custom drawing | One `CanvasBox` draws the progress ring and its numeric annotation. Ordinary interface elements remain widgets. |
| Shared host entry | One IIFE bundle uses the public commit/dispatch contract for both the generic browser host and QuickJS. |
| Automatic browser/Android viewport delivery | Implemented (TN-158): the generic browser host delivers canvas CSS-pixel bounds on boot and resize; the Android `SurfaceView` delivers density-independent logical bounds on surface changes and engine swaps. Both negotiate once — a bundle whose handoff has no `setViewport` answers `UNKNOWN_ACTION` and keeps its own design-width scaling. |
| Editable text and Android IME through widgets | Pending the native edit-session and widget integration. |
| Independent scroll viewport | Pending. The three-task checklist currently uses a fixed layout. |
| Host-evaluated animation and route transitions | Pending. The ring changes with state and navigation switches immediately. |
| Semantic widget colors, inherited themes, runtime switching | TN-068 remains the owner. This foundation uses the existing single-theme `defineTheme` API. |

TN-155 stays open until its complete browser/Android journey and required
evidence exist. This foundation is not yet the README's headline demo.

## Run the application tests

From the repository root after installing the pinned dependencies:

```sh
bun test examples/framework-feel
```

Screen tests exercise named actions. Runtime tests inspect emitted scenes,
nested layout, tap placement, explicit viewport changes, custom drawing,
and both retained screen sessions through the public handoff.

`createFrameworkFeelRuntime(viewport)` in `src/runtime.ts` is the sole
runtime factory. Its default is 720×1000; callers can supply another finite
viewport and call `setViewport()` without rewriting the screen tree. The
application does not calculate child heights from the viewport.

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

Press **Complete task**, **View progress**, **Show details**, and **Back to
today**. A second visit retains the details state and shows the updated
completion count. The generic shell negotiates viewport support on boot: this bundle adopts
the canvas's CSS-pixel bounds (and re-lays out on window resize), while
older bundles keep the scaled-scene behavior.

The same generated script is suitable for the native QuickJS engine-loop
gate. Scene-data parity proves the shared application path; it does not
claim pixel identity, real-device rendering, IME support, or the remaining
TN-155 capabilities.
