---
okf_version: 0.2
title: "Framework Positioning"
summary: "How TenunJS compares with React Native, Flutter, NativeScript, and Capacitor — and where it honestly stands."
type: architecture
status: accepted
---

# Framework positioning

This document records how TenunJS compares with the established
TypeScript/Dart mobile frameworks, both to guide communication and to prevent
positioning drift. It is descriptive, not a measured benchmark: every
performance and smoothness claim is an architectural goal awaiting
physical-device evidence (ADR-0019).

## Comparison

| Dimension | TenunJS | React Native | Flutter | NativeScript | Capacitor |
| --- | --- | --- | --- | --- | --- |
| Primary language | TypeScript + TSX | JavaScript/TypeScript + React | Dart | JavaScript/TypeScript, with several UI-framework options | HTML, CSS, JavaScript and any web framework |
| UI model | Controllers, typed actions, widgets | React components and React state semantics | Reactive widget tree | NativeScript Core or Angular/Vue/React/Svelte/etc. | Ordinary web application inside a native container |
| Default rendering | Retained native scene rendered with Skia | Platform host views managed by Fabric | Flutter's own rendering engine | Platform-native UI elements and APIs | WebView |
| React required | No | Yes | No | Optional | Optional |
| CSS/DOM | No | No DOM; React Native styling | No | No browser DOM for native UI | Yes |
| Platform consistency | Intended to be highly consistent | Native-view behavior can differ by platform | Highly consistent custom rendering | Closely follows each platform's native controls | Depends heavily on browser/WebView behavior |
| Production maturity | Design and spike phase | Mature production ecosystem | Mature production ecosystem | Existing production framework | Existing production framework |
| Web reuse | Not an initial target | Possible through adjacent React ecosystem | Official web target | Some cross-platform options, primarily native-focused | Excellent; web-first is the main proposition |

TenunJS's rendering model is much closer to Flutter than to core React
Native. React Native's Fabric renderer manages a tree of platform host views,
with layout commonly calculated through Yoga; its New Architecture uses JSI
rather than the old asynchronous serialized bridge. Flutter also owns its
rendering engine and platform embedders, but applications are written in Dart
and use Flutter's mature reactive widget framework. NativeScript takes the
opposite rendering trade-off: it exposes platform APIs directly to JavaScript
and supports several UI-framework flavors, providing strong access to native
controls but exposing more platform-specific differences. Capacitor is
web-first: it places a web application inside a native container and exposes
native capabilities through plugins — excellent for reusing an existing
browser application, but its UI remains governed by WebView and browser
rendering rather than a custom native Skia scene.

## Intended advantages

1. **TypeScript and TSX without inheriting React semantics.** The distinctive
   proposition is not "use TypeScript for mobile" — React Native,
   NativeScript, and Capacitor already do that. It is TypeScript + TSX
   *without React, without hooks, without a DOM, with a Flutter-like custom
   rendering engine*. That can produce a smaller conceptual surface: explicit
   controller state, named typed actions, explicit async concurrency,
   feature-local organization, no hook-order rules, no dependency-array
   bugs, and no requirement to preserve React compatibility forever. The
   trade-off: TenunJS must build everything React normally supplies —
   reconciliation, scheduling, error boundaries, testing semantics,
   developer tools, debugging, and a component ecosystem.

2. **More controlled state transitions.** The action model is deliberately
   restrictive: event → typed action → bounded transaction → one committed
   state. That may make application behavior easier to inspect and easier
   for coding agents to modify safely. This is a potential advantage, not
   yet a measured one; a restrictive framework can also become frustrating
   when an application needs behavior outside the intended happy path.

3. **Rendering consistency across iOS and Android.** Because ordinary
   widgets render through the shared Skia engine, TenunJS can theoretically
   produce more consistent layout and visuals across platforms than
   frameworks built primarily from UIKit and Android View objects. Useful
   for dashboards, operational applications, branded business applications,
   custom data visualization, and moderately animated consumer interfaces —
   the workloads the repository explicitly targets.

4. **Scrolling and animation do not depend on JS per frame.** Animation
   graphs are configured from JavaScript while frame values are evaluated
   natively; the same principle applies to scrolling. A busy JavaScript
   thread should not automatically freeze an active scroll or animation.
   Until H4 and the later scene/widget milestones complete, smoothness is an
   architectural goal — not a demonstrated framework property.

5. **Explicit and fail-closed native boundaries.** Versioned contracts for
   application bundles, runtime host functions, mutation transactions,
   layout adapters, native modules, and platform capabilities. The proposed
   native-module API generates TypeScript, Swift, Kotlin, mock, and
   compatibility bindings, with missing required capabilities failing at
   startup. More rigid than unrestricted native access, but it prevents an
   entire class of accidental cross-platform contract drift.

## Honest disadvantages

1. **You cannot build a real product with it today.** This is the decisive
   disadvantage. The API examples describe the intended M3/M4 surface. The
   roadmap still needs M0 (engine/runtime/layout selection), M1 (executable
   toolchain and mobile hosts), M2 (native scene and Skia renderer), M3
   (TSX/controllers/actions/navigation), and M4 (usable widget, text-input,
   scrolling, and animation layer). React Native, Flutter, NativeScript, and
   Capacitor can all ship applications today. TenunJS is currently a
   framework-development project, not an application-development dependency.

2. **Almost no ecosystem.** No established collection of authentication
   integrations, analytics SDK wrappers, maps, payments, camera libraries,
   push notification packages, crash reporting, charting components, or
   accessibility-tested design systems. TenunJS will initially need to
   implement or wrap every important capability itself.

3. **Custom-rendered controls are expensive to get right.** Drawing a button
   is easy; building a mobile framework-quality button is not. TenunJS must
   correctly implement focus, screen-reader semantics, dynamic type,
   keyboard navigation, high contrast, reduced motion, bidirectional text,
   font fallback, selection, IME composition, autofill, platform gestures,
   and platform accessibility actions. The project recognizes platform-native
   text input and accessibility as foundational, but those systems are later
   roadmap work. NativeScript and React Native gain more native behavior
   from platform host controls; Flutter has already spent years implementing
   its custom-rendered equivalents.

4. **More layers to debug.** A production failure could cross: TypeScript
   application → custom reconciler → binary mutation protocol → native scene
   engine → layout backend → Skia → Swift/Kotlin embedder → platform GPU/API.
   This is clean when every boundary has strong diagnostics; during early
   development it is a larger debugging surface than a conventional native
   or WebView application.

5. **Startup time, memory, and binary size are still unknown.** A TenunJS
   application will likely include a JavaScript runtime, a native engine,
   Skia, layout code, platform embedders, and an application bundle. Claims
   about small binaries, fast startup, and low memory wait for
   physical-device evidence; the project rejects performance folklore.

6. **No initial web or desktop target.** Sensible scope discipline, but a
   disadvantage for teams expecting one codebase across mobile, browser,
   and desktop.

## Choosing between them

| Your priority | Most sensible choice |
| --- | --- |
| Ship a TypeScript mobile product now, with a large ecosystem | React Native, usually through Expo |
| Uniform custom-rendered UI with mature tooling | Flutter |
| TypeScript plus direct access to native platform APIs and controls | NativeScript |
| Reuse an existing React/Vue/Svelte web application | Capacitor |
| Build a new framework around TSX, a controlled state model, and a shared Skia engine | TenunJS |
| Ship a commercial application with low framework risk today | Not TenunJS yet |

## Positioning language

The strongest positioning is:

> A TypeScript/TSX mobile UI framework with Flutter-like engine ownership,
> but without Dart, React, or a browser runtime.

Avoid:

- **"React Native without the bridge."** React Native's New Architecture
  already replaced the asynchronous bridge with JSI. TenunJS's real
  differentiation is its custom rendering substrate, restricted
  controller/action model, and ownership of the full widget contract — not
  simply faster JavaScript/native calls.
- **"Flutter, but in TypeScript."** Directionally useful, but it hides the
  giant maturity gap: Flutter already has a complete engine, widget
  catalogue, platform integrations, profiling tools, hot reload,
  accessibility implementation, plugin ecosystem, and broad platform
  support.

## Practical conclusion

TenunJS has a coherent and interesting architecture, especially for teams
that prefer TypeScript, dislike React's programming model, want highly
consistent branded interfaces, are comfortable owning native engine
infrastructure, and value strict, generated cross-language contracts. Right
now it is appropriate for framework research, architecture validation,
engine prototyping, and future pilot planning — not for shipping a customer
application, meeting a fixed product deadline, depending on third-party
mobile SDKs, or replacing React Native or Flutter in production. Once M3 and
the first usable M4 widget slice land, the
[complete example app](../04-api/counter-app-example.md) should become a
meaningful runnable smoke test; until then it is presented as an intended
API preview, not a quickstart.
